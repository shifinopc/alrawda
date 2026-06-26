<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use App\Models\Invoice;
use App\Models\InvoiceActivity;
use App\Models\InvoiceNumberSetting;
use App\Models\Package;
use App\Models\Service;
use App\Models\TaxSetting;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class InvoiceController extends Controller
{
    public function index(Request $request): View
    {
        $query = Invoice::with('customer');
        if ($request->filled('search')) {
            $q = $request->search;
            $query->where(function ($qry) use ($q) {
                $qry->where('invoice_number', 'like', "%{$q}%")
                    ->orWhereHas('customer', fn ($c) => $c->where('name', 'like', "%{$q}%"));
            });
        }
        if ($request->filled('status')) {
            if ($request->status === 'overdue') {
                $query->where('status', '!=', 'draft')
                    ->whereNotNull('due_date')
                    ->whereDate('due_date', '<', now());
            } else {
                $query->where('status', $request->status);
            }
        }
        if ($request->filled('from')) {
            $query->whereDate('invoice_date', '>=', $request->from);
        }
        if ($request->filled('to')) {
            $query->whereDate('invoice_date', '<=', $request->to);
        }
        $sort = $request->input('sort', 'created_at');
        $dir = $request->input('dir', 'desc');
        if ($request->input('order') === 'oldest') {
            $dir = 'asc';
        } elseif ($request->input('order', 'latest') === 'latest') {
            $dir = 'desc';
        }
        $allowedSort = ['invoice_date', 'invoice_number', 'grand_total', 'created_at'];
        if (in_array($sort, $allowedSort)) {
            $query->orderBy($sort, $dir === 'asc' ? 'asc' : 'desc');
        } else {
            $query->orderBy('created_at', 'desc');
        }
        $invoices = $query->paginate(8)->withQueryString();
        return view('invoices.index', compact('invoices'));
    }

    public function bulkApprove(Request $request): RedirectResponse
    {
        $ids = $request->input('ids', []);
        $count = Invoice::whereIn('id', $ids)->where('status', 'draft')->update(['status' => 'approved']);
        return back()->with('success', "{$count} invoice(s) approved.");
    }

    public function bulkDelete(Request $request): RedirectResponse
    {
        $ids = $request->input('ids', []);
        $count = Invoice::whereIn('id', $ids)->where('status', 'draft')->delete();
        return back()->with('success', "{$count} draft invoice(s) deleted.");
    }

    public function create(): View
    {
        $customers = Customer::orderBy('name')->get();
        $services = Service::orderBy('name')->get();
        $packages = Package::with('items.service')->orderBy('name')->get()->map(fn (Package $p) => [
            'id' => (int) $p->id,
            'name' => $p->name,
            'taxable' => $p->getPackageTaxableAmount(),
            'non_taxable' => $p->getPackageNonTaxableAmount(),
        ])->values();
        $taxSetting = TaxSetting::first();
        return view('invoices.create', compact('customers', 'services', 'packages', 'taxSetting'));
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'customer_id' => ['required', 'exists:customers,id'],
            'invoice_date' => ['required', 'date'],
            'due_date' => ['nullable', 'date', 'after_or_equal:invoice_date'],
            'notes' => ['nullable', 'string'],
            'discount_amount' => ['nullable', 'numeric', 'min:0'],
            'rounding_adjustment' => ['nullable', 'numeric'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.service_id' => ['nullable', 'exists:services,id'],
            'items.*.package_id' => ['nullable', 'exists:packages,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
        ]);

        foreach ($validated['items'] as $i => $item) {
            $hasService = ! empty($item['service_id']);
            $hasPackage = ! empty($item['package_id']);
            if ($hasService === $hasPackage) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    "items.{$i}.service_id" => ['Each line must be either a service or a package.'],
                ]);
            }
        }

        $taxSetting = TaxSetting::first();
        $vatRate = $taxSetting && $taxSetting->vat_enabled ? (float) $taxSetting->vat_percentage / 100 : 0;
        $discountAmount = (float) ($validated['discount_amount'] ?? 0);
        $roundingAdjustment = (float) ($validated['rounding_adjustment'] ?? 0);

        $numberSetting = InvoiceNumberSetting::first();
        if (! $numberSetting) {
            $numberSetting = InvoiceNumberSetting::create(['prefix' => 'INV', 'next_number' => 1, 'padding' => 5]);
        }
        $invoiceNumber = $numberSetting->prefix . '-' . str_pad((string) $numberSetting->next_number, $numberSetting->padding, '0', STR_PAD_LEFT);

        DB::beginTransaction();
        try {
            $invoice = new Invoice;
            $invoice->invoice_number = $invoiceNumber;
            $invoice->customer_id = $validated['customer_id'];
            $invoice->invoice_date = $validated['invoice_date'];
            $invoice->due_date = $validated['due_date'] ?? null;
            $invoice->notes = $validated['notes'] ?? null;
            $invoice->status = 'draft';

            $subtotalTaxable = 0;
            $subtotalNonTaxable = 0;
            $vatAmount = 0;

            foreach ($validated['items'] as $itemData) {
                $qty = (int) $itemData['quantity'];
                if (! empty($itemData['package_id'])) {
                    $package = Package::with('items.service')->findOrFail($itemData['package_id']);
                    $lineTaxable = (float) $package->getPackageTaxableAmount() * $qty;
                    $lineNonTaxable = (float) $package->getPackageNonTaxableAmount() * $qty;
                } else {
                    $service = Service::findOrFail($itemData['service_id']);
                    $lineTaxable = (float) $service->taxable_amount * $qty;
                    $lineNonTaxable = (float) $service->non_taxable_amount * $qty;
                }
                $lineTax = $lineTaxable * $vatRate;
                $subtotalTaxable += $lineTaxable;
                $subtotalNonTaxable += $lineNonTaxable;
                $vatAmount += $lineTax;
            }

            $invoice->subtotal_taxable = round($subtotalTaxable, 2);
            $invoice->subtotal_non_taxable = round($subtotalNonTaxable, 2);
            $invoice->vat_amount = round($vatAmount, 2);
            $invoice->discount_amount = round($discountAmount, 2);
            $invoice->rounding_adjustment = round($roundingAdjustment, 2);
            $baseTotal = $subtotalTaxable + $subtotalNonTaxable + $vatAmount;
            $invoice->grand_total = round(max(0, $baseTotal - $discountAmount + $roundingAdjustment), 2);
            $invoice->save();

            foreach ($validated['items'] as $itemData) {
                $qty = (int) $itemData['quantity'];
                if (! empty($itemData['package_id'])) {
                    $package = Package::with('items.service')->findOrFail($itemData['package_id']);
                    $lineTaxable = (float) $package->getPackageTaxableAmount() * $qty;
                    $lineNonTaxable = (float) $package->getPackageNonTaxableAmount() * $qty;
                    $lineTax = $lineTaxable * $vatRate;
                    $invoice->items()->create([
                        'service_id' => null,
                        'package_id' => $package->id,
                        'quantity' => $qty,
                        'taxable_amount' => $lineTaxable,
                        'non_taxable_amount' => $lineNonTaxable,
                        'line_tax' => round($lineTax, 2),
                        'line_total' => round($lineTaxable + $lineNonTaxable + $lineTax, 2),
                    ]);
                } else {
                    $service = Service::findOrFail($itemData['service_id']);
                    $lineTaxable = (float) $service->taxable_amount * $qty;
                    $lineNonTaxable = (float) $service->non_taxable_amount * $qty;
                    $lineTax = $lineTaxable * $vatRate;
                    $invoice->items()->create([
                        'service_id' => $service->id,
                        'package_id' => null,
                        'quantity' => $qty,
                        'taxable_amount' => $lineTaxable,
                        'non_taxable_amount' => $lineNonTaxable,
                        'line_tax' => round($lineTax, 2),
                        'line_total' => round($lineTaxable + $lineNonTaxable + $lineTax, 2),
                    ]);
                }
            }

            $numberSetting->increment('next_number');

            $invoice->addActivity('created', 'Invoice created as draft.');

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return redirect()->route('invoices.show', $invoice)->with('success', 'Invoice created successfully.');
    }

    public function edit(Invoice $invoice): View|RedirectResponse
    {
        if ($invoice->status !== 'draft') {
            return redirect()->route('invoices.show', $invoice)->with('error', 'Only draft invoices can be edited.');
        }
        $invoice->load(['items.service', 'items.package']);
        $customers = Customer::orderBy('name')->get();
        $services = Service::orderBy('name')->get();
        $allPackages = Package::with('items.service')->orderBy('name')->get();
        $packageIdsOnInvoice = $invoice->items->pluck('package_id')->filter()->unique()->values();
        $extraPackages = Package::with('items.service')->whereIn('id', $packageIdsOnInvoice)->get();
        $packagesForEdit = $allPackages->merge($extraPackages)->unique('id')->sortBy('name')->values();
        $packages = $packagesForEdit->map(fn (Package $p) => [
            'id' => (int) $p->id,
            'name' => $p->name,
            'taxable' => $p->getPackageTaxableAmount(),
            'non_taxable' => $p->getPackageNonTaxableAmount(),
        ])->values();
        $taxSetting = TaxSetting::first();
        return view('invoices.edit', compact('invoice', 'customers', 'services', 'packages', 'taxSetting'));
    }

    public function update(Request $request, Invoice $invoice): RedirectResponse
    {
        if ($invoice->status !== 'draft') {
            return redirect()->route('invoices.show', $invoice)->with('error', 'Only draft invoices can be edited.');
        }
        $validated = $request->validate([
            'customer_id' => ['required', 'exists:customers,id'],
            'invoice_date' => ['required', 'date'],
            'due_date' => ['nullable', 'date', 'after_or_equal:invoice_date'],
            'notes' => ['nullable', 'string'],
            'discount_amount' => ['nullable', 'numeric', 'min:0'],
            'rounding_adjustment' => ['nullable', 'numeric'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.service_id' => ['nullable', 'exists:services,id'],
            'items.*.package_id' => ['nullable', 'exists:packages,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
        ]);

        foreach ($validated['items'] as $i => $item) {
            $hasService = ! empty($item['service_id']);
            $hasPackage = ! empty($item['package_id']);
            if ($hasService === $hasPackage) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    "items.{$i}.service_id" => ['Each line must be either a service or a package.'],
                ]);
            }
        }

        $taxSetting = TaxSetting::first();
        $vatRate = $taxSetting && $taxSetting->vat_enabled ? (float) $taxSetting->vat_percentage / 100 : 0;
        $discountAmount = (float) ($validated['discount_amount'] ?? 0);
        $roundingAdjustment = (float) ($validated['rounding_adjustment'] ?? 0);

        DB::beginTransaction();
        try {
            $invoice->customer_id = $validated['customer_id'];
            $invoice->invoice_date = $validated['invoice_date'];
            $invoice->due_date = $validated['due_date'] ?? null;
            $invoice->notes = $validated['notes'] ?? null;

            $subtotalTaxable = 0;
            $subtotalNonTaxable = 0;
            $vatAmount = 0;

            foreach ($validated['items'] as $itemData) {
                $qty = (int) $itemData['quantity'];
                if (! empty($itemData['package_id'])) {
                    $package = Package::with('items.service')->findOrFail($itemData['package_id']);
                    $lineTaxable = (float) $package->getPackageTaxableAmount() * $qty;
                    $lineNonTaxable = (float) $package->getPackageNonTaxableAmount() * $qty;
                } else {
                    $service = Service::findOrFail($itemData['service_id']);
                    $lineTaxable = (float) $service->taxable_amount * $qty;
                    $lineNonTaxable = (float) $service->non_taxable_amount * $qty;
                }
                $lineTax = $lineTaxable * $vatRate;
                $subtotalTaxable += $lineTaxable;
                $subtotalNonTaxable += $lineNonTaxable;
                $vatAmount += $lineTax;
            }

            $invoice->subtotal_taxable = round($subtotalTaxable, 2);
            $invoice->subtotal_non_taxable = round($subtotalNonTaxable, 2);
            $invoice->vat_amount = round($vatAmount, 2);
            $invoice->discount_amount = round($discountAmount, 2);
            $invoice->rounding_adjustment = round($roundingAdjustment, 2);
            $baseTotal = $subtotalTaxable + $subtotalNonTaxable + $vatAmount;
            $invoice->grand_total = round(max(0, $baseTotal - $discountAmount + $roundingAdjustment), 2);
            $invoice->save();

            $invoice->items()->delete();
            foreach ($validated['items'] as $itemData) {
                $qty = (int) $itemData['quantity'];
                if (! empty($itemData['package_id'])) {
                    $package = Package::with('items.service')->findOrFail($itemData['package_id']);
                    $lineTaxable = (float) $package->getPackageTaxableAmount() * $qty;
                    $lineNonTaxable = (float) $package->getPackageNonTaxableAmount() * $qty;
                    $lineTax = $lineTaxable * $vatRate;
                    $invoice->items()->create([
                        'service_id' => null,
                        'package_id' => $package->id,
                        'quantity' => $qty,
                        'taxable_amount' => $lineTaxable,
                        'non_taxable_amount' => $lineNonTaxable,
                        'line_tax' => round($lineTax, 2),
                        'line_total' => round($lineTaxable + $lineNonTaxable + $lineTax, 2),
                    ]);
                } else {
                    $service = Service::findOrFail($itemData['service_id']);
                    $lineTaxable = (float) $service->taxable_amount * $qty;
                    $lineNonTaxable = (float) $service->non_taxable_amount * $qty;
                    $lineTax = $lineTaxable * $vatRate;
                    $invoice->items()->create([
                        'service_id' => $service->id,
                        'package_id' => null,
                        'quantity' => $qty,
                        'taxable_amount' => $lineTaxable,
                        'non_taxable_amount' => $lineNonTaxable,
                        'line_tax' => round($lineTax, 2),
                        'line_total' => round($lineTaxable + $lineNonTaxable + $lineTax, 2),
                    ]);
                }
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return redirect()->route('invoices.show', $invoice)->with('success', 'Invoice updated successfully.');
    }

    public function show(Invoice $invoice): View
    {
        $invoice->load(['customer.payments', 'items.service', 'items.package', 'payments', 'activities' => fn ($q) => $q->latest()]);
        $advanceBalance = $invoice->customer->advanceBalance();
        return view('invoices.show', compact('invoice', 'advanceBalance'));
    }

    public function pdf(Request $request, Invoice $invoice)
    {
        $invoice->load(['customer', 'items.service', 'items.package']);
        $company = \App\Models\CompanySetting::first();
        $template = \App\Models\InvoiceTemplateSetting::first();
        $preparedBy = auth()->user()?->name;
        $pdf = Pdf::loadView('invoices.pdf', compact('invoice', 'company', 'template', 'preparedBy'));
        if ($request->boolean('preview')) {
            return $pdf->stream("invoice-{$invoice->invoice_number}.pdf");
        }
        return $pdf->download("invoice-{$invoice->invoice_number}.pdf");
    }

    public function approve(Invoice $invoice): RedirectResponse
    {
        if ($invoice->status === 'draft') {
            $invoice->status = 'approved';
            $invoice->save();
            $invoice->addActivity('approved', 'Invoice approved as official.');
        }
        return redirect()->route('invoices.show', $invoice)->with('success', 'Invoice approved as official.');
    }

    public function destroy(Invoice $invoice): RedirectResponse
    {
        if ($invoice->status !== 'draft') {
            return redirect()->route('invoices.show', $invoice)->with('error', 'Only draft invoices can be deleted.');
        }

        if ($invoice->payments()->exists()) {
            return redirect()->route('invoices.show', $invoice)->with('error', 'Cannot delete an invoice that has payments recorded.');
        }

        InvoiceActivity::create([
            'invoice_id' => $invoice->id,
            'event' => 'deleted',
            'description' => 'Draft invoice deleted.',
            'performed_by' => auth()->user()?->name,
        ]);

        $invoice->delete();

        return redirect()->route('invoices.index')->with('success', 'Invoice deleted successfully.');
    }

    public function withdraw(Invoice $invoice): RedirectResponse
    {
        if ($invoice->status !== 'approved') {
            return redirect()->route('invoices.show', $invoice)->with('error', 'Only approved invoices can be withdrawn back to draft.');
        }

        if ($invoice->payments()->exists()) {
            return redirect()->route('invoices.show', $invoice)->with('error', 'Cannot withdraw an invoice that has payments recorded.');
        }

        $invoice->status = 'draft';
        $invoice->save();
        $invoice->addActivity('withdrawn', 'Invoice moved back to draft.');

        return redirect()->route('invoices.show', $invoice)->with('success', 'Invoice moved back to draft.');
    }

    public function sendEmail(Invoice $invoice): RedirectResponse
    {
        // Check if customer has email (for backward compatibility with existing customers)
        $email = $invoice->customer->email ?? null;
        if (! $email) {
            return back()->with('error', 'Customer has no email address. Please contact customer via phone.');
        }
        \App\Mail\InvoicePdfMail::sendTo($invoice, $email);
        return back()->with('success', "Invoice sent to {$email}.");
    }
}
