<?php

namespace App\Http\Controllers;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Customer;
use App\Models\PaymentNumberSetting;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class PaymentController extends Controller
{
    public function index(): View
    {
        $payments = Payment::with(['invoice.customer', 'customer'])->latest()->paginate(8)->withQueryString();
        $all = Invoice::with('customer', 'payments')
            ->whereIn('status', ['approved', 'partially_paid'])
            ->latest()
            ->get();
        $invoices = $all->filter(fn ($i) => (float) $i->grand_total - $i->payments->sum('amount') > 0)->values();
        $customers = Customer::orderBy('name')->get();
        return view('payments.index', compact('payments', 'invoices', 'customers'));
    }

    public function create(): View
    {
        $all = Invoice::with('customer', 'payments')
            ->whereIn('status', ['approved', 'partially_paid'])
            ->latest()
            ->get();
        $invoices = $all->filter(fn ($i) => (float) $i->grand_total - $i->payments->sum('amount') > 0)->values();
        $customers = Customer::orderBy('name')->get();
        return view('payments.create', compact('invoices', 'customers'));
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'invoice_id' => ['required', 'exists:invoices,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'payment_date' => ['required', 'date'],
            'payment_method' => ['nullable', 'string', 'max:50'],
            'reference' => ['nullable', 'string', 'max:100'],
            'notes' => ['nullable', 'string'],
        ]);

        $invoice = Invoice::findOrFail($validated['invoice_id']);
        $totalPaid = $invoice->totalPaid();
        $newTotal = $totalPaid + (float) $validated['amount'];
        if ($newTotal > (float) $invoice->grand_total) {
            return redirect()->route('payments.index')->withErrors(['amount' => 'Payment amount exceeds invoice total.'])->withInput();
        }

        $payment = Payment::create($validated + [
            'payment_number' => $this->nextPaymentNumber(),
            'customer_id' => $invoice->customer_id,
            'remaining_amount' => null,
            'is_advance' => false,
        ]);

        if ($newTotal >= (float) $invoice->grand_total) {
            $invoice->update(['status' => 'paid']);
        } else {
            $invoice->update(['status' => 'partially_paid']);
        }

        $invoice->addActivity('payment_recorded', 'Payment of ' . number_format((float) $payment->amount, 2) . ' AED recorded.');

        return redirect()->route('payments.index')->with('success', 'Payment recorded successfully.');
    }

    /**
     * Store an advance payment (credit) for a customer without tying it
     * to a specific invoice yet.
     */
    public function storeAdvance(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'customer_id' => ['required', 'exists:customers,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'payment_date' => ['required', 'date'],
            'payment_method' => ['nullable', 'string', 'max:50'],
            'reference' => ['nullable', 'string', 'max:100'],
            'notes' => ['nullable', 'string'],
        ]);

        Payment::create([
            'payment_number' => $this->nextPaymentNumber(),
            'customer_id' => $validated['customer_id'],
            'invoice_id' => null,
            'amount' => $validated['amount'],
            'remaining_amount' => $validated['amount'],
            'payment_date' => $validated['payment_date'],
            'payment_method' => $validated['payment_method'] ?? null,
            'reference' => $validated['reference'] ?? null,
            'notes' => $validated['notes'] ?? null,
            'is_advance' => true,
        ]);

        $invoice = null;
        if (isset($validated['invoice_id'])) {
            $invoice = Invoice::find($validated['invoice_id']);
        }

        return redirect()->route('payments.index')->with('success', 'Advance payment recorded successfully.');
    }

    /**
     * Apply a customer's advance balance to a specific invoice.
     */
    public function applyAdvance(Request $request, Invoice $invoice): RedirectResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'payment_date' => ['required', 'date'],
            'notes' => ['nullable', 'string'],
        ]);

        $customer = $invoice->customer;
        $available = $customer->advanceBalance();
        $outstanding = $invoice->outstandingAmount();

        if ($available <= 0) {
            return back()->with('error', 'No advance balance available for this customer.');
        }

        if ($data['amount'] > $available) {
            return back()->with('error', 'Amount exceeds available advance balance.')->withInput();
        }

        if ($data['amount'] > $outstanding) {
            return back()->with('error', 'Amount exceeds outstanding invoice balance.')->withInput();
        }

        DB::transaction(function () use ($invoice, $customer, $data) {
            $remainingToApply = (float) $data['amount'];

            // Consume from oldest advances first
            $advances = Payment::where('customer_id', $customer->id)
                ->where('is_advance', true)
                ->where('remaining_amount', '>', 0)
                ->orderBy('payment_date')
                ->lockForUpdate()
                ->get();

            foreach ($advances as $advance) {
                if ($remainingToApply <= 0) {
                    break;
                }
                $usable = min((float) $advance->remaining_amount, $remainingToApply);
                $advance->remaining_amount = (float) $advance->remaining_amount - $usable;
                $advance->save();
                $remainingToApply -= $usable;
            }

            // Record payment against the invoice sourced from advance
            $payment = Payment::create([
                'payment_number' => $this->nextPaymentNumber(),
                'invoice_id' => $invoice->id,
                'customer_id' => $customer->id,
                'amount' => $data['amount'],
                'remaining_amount' => null,
                'payment_date' => $data['payment_date'],
                'payment_method' => 'Advance Adjustment',
                'reference' => null,
                'notes' => $data['notes'] ?? null,
                'is_advance' => false,
            ]);

            $newTotal = $invoice->totalPaid() + (float) $payment->amount;
            if ($newTotal >= (float) $invoice->grand_total) {
                $invoice->update(['status' => 'paid']);
            } else {
                $invoice->update(['status' => 'partially_paid']);
            }

            $invoice->addActivity('advance_applied', 'Advance of ' . number_format((float) $payment->amount, 2) . ' AED applied.');
        });

        return back()->with('success', 'Advance applied to invoice successfully.');
    }

    /**
     * Delete a payment and keep invoice / advance balances consistent.
     */
    public function destroy(Payment $payment): RedirectResponse
    {
        // Block deleting advances that have already been used.
        if ($payment->is_advance && $payment->remaining_amount !== null && (float) $payment->remaining_amount < (float) $payment->amount) {
            return back()->with('error', 'Cannot delete an advance that has already been used.')->withInput();
        }

        DB::transaction(function () use ($payment) {
            $invoice = $payment->invoice;
            $customer = $payment->customer ?? $invoice?->customer;

            // If this payment was an advance adjustment, re-credit the customer's advances.
            if (! $payment->is_advance && $customer && $payment->payment_method === 'Advance Adjustment') {
                $refund = (float) $payment->amount;

                $advances = Payment::where('customer_id', $customer->id)
                    ->where('is_advance', true)
                    ->orderByDesc('payment_date')
                    ->lockForUpdate()
                    ->get();

                foreach ($advances as $advance) {
                    if ($refund <= 0) {
                        break;
                    }

                    // Do not exceed the original advance amount.
                    $headroom = (float) $advance->amount - (float) ($advance->remaining_amount ?? 0);
                    if ($headroom <= 0) {
                        continue;
                    }

                    $addBack = min($headroom, $refund);
                    $advance->remaining_amount = (float) $advance->remaining_amount + $addBack;
                    $advance->save();
                    $refund -= $addBack;
                }
            }

            $payment->delete();

            if ($invoice) {
                $totalPaid = (float) $invoice->payments()->sum('amount');
                if ($totalPaid <= 0) {
                    // Fall back to approved if it was an official invoice.
                    if ($invoice->status !== 'draft') {
                        $invoice->status = 'approved';
                    }
                } elseif ($totalPaid < (float) $invoice->grand_total) {
                    $invoice->status = 'partially_paid';
                } else {
                    $invoice->status = 'paid';
                }
                $invoice->save();
                
                // Add activity log inside the transaction
                $invoice->addActivity('payment_deleted', 'Payment of ' . number_format((float) $payment->amount, 2) . ' AED deleted.');
            }
        });

        return back()->with('success', 'Payment deleted successfully.');
    }

    /**
     * Generate and return payment receipt PDF.
     */
    public function receipt(Request $request, Payment $payment)
    {
        $payment->load(['customer', 'invoice']);
        $customer = $payment->customer ?? $payment->invoice?->customer;
        
        if (!$customer) {
            abort(404, 'Customer not found for this payment.');
        }

        $company = \App\Models\CompanySetting::first();
        $template = \App\Models\InvoiceTemplateSetting::first();
        $preparedBy = auth()->user()?->name;
        
        $pdf = Pdf::loadView('payments.receipt', compact('payment', 'customer', 'company', 'template', 'preparedBy'));
        
        if ($request->boolean('preview')) {
            return $pdf->stream("payment-receipt-{$payment->id}.pdf");
        }
        
        return $pdf->download("payment-receipt-{$payment->id}.pdf");
    }

    private function nextPaymentNumber(): string
    {
        return DB::transaction(function () {
            $setting = PaymentNumberSetting::lockForUpdate()->first();
            if (! $setting) {
                $setting = PaymentNumberSetting::create(['prefix' => 'PAY', 'next_number' => 1, 'padding' => 5]);
            }
            $number = $setting->next_number;
            $prefix = $setting->prefix;
            $padding = (int) $setting->padding;
            $setting->increment('next_number');
            return $prefix . '-' . str_pad((string) $number, $padding, '0', STR_PAD_LEFT);
        });
    }
}
