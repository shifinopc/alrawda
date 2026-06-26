<?php

namespace App\Http\Controllers;

use App\Exports\CustomerReportExport;
use App\Models\Customer;
use App\Models\Invoice;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\View\View;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class ReportController extends Controller
{
    public function customerReports(Request $request): View
    {
        $customers = Customer::orderBy('name')->get();
        $customer = null;
        $summary = null;
        $invoiceBreakdown = [];
        $serviceBreakdown = [];
        $paymentProfit = null;
        $invoices = collect();

        if ($request->filled('customer_id')) {
            $customer = Customer::find((int) $request->customer_id);
            if ($customer) {
                $query = $customer->invoices()->with('items.service', 'items.package', 'payments');
                if ($request->filled('from')) {
                    $query->whereDate('invoice_date', '>=', $request->from);
                }
                if ($request->filled('to')) {
                    $query->whereDate('invoice_date', '<=', $request->to);
                }
                // Filter by status: explicit value, or default to approved & beyond (exclude draft)
                $statusFilter = $request->input('status');
                if ($statusFilter !== null && $statusFilter !== '') {
                    $query->where('status', $statusFilter);
                } else {
                    $query->where('status', '!=', 'draft');
                }
                $invoices = $query->orderByDesc('invoice_date')->orderByDesc('id')->get();

                $totalInvoices = $invoices->count();
                $totalBilled = $invoices->sum('grand_total');
                $totalTax = $invoices->sum('vat_amount');
                $totalPaid = $invoices->sum(fn ($i) => $i->payments->sum('amount'));
                $outstanding = $totalBilled - $totalPaid;
                $revenueExclTax = $invoices->sum('subtotal_taxable') + $invoices->sum('subtotal_non_taxable');
                $totalProfit = $revenueExclTax; // Simplified: profit = revenue (no cost tracking in spec)

                $summary = (object) [
                    'total_invoices' => $totalInvoices,
                    'total_billed' => $totalBilled,
                    'total_tax_collected' => $totalTax,
                    'total_paid' => $totalPaid,
                    'outstanding' => $outstanding,
                    'total_profit' => $totalProfit,
                ];

                $invoiceBreakdown = $invoices->take(3)->map(fn ($inv) => (object) [
                    'invoice' => $inv,
                    'services_count' => $inv->items->count(),
                    'payment_status' => $inv->status,
                ])->values()->all();

                $serviceBreakdown = [];
                foreach ($invoices as $inv) {
                    foreach ($inv->items as $item) {
                        $name = $item->service_id && $item->service
                            ? $item->service->name
                            : ($item->package_id && $item->package ? $item->package->name : '—');
                        $serviceBreakdown[] = (object) [
                            'invoice_date' => $inv->invoice_date,
                            'service_name' => $name,
                            'invoice_number' => $inv->invoice_number,
                            'quantity' => $item->quantity,
                            'taxable_amount' => $item->taxable_amount,
                            'non_taxable_amount' => $item->non_taxable_amount,
                            'tax_amount' => $item->line_tax,
                            'line_total' => $item->line_total,
                        ];
                    }
                }
                $serviceBreakdown = collect($serviceBreakdown)->sortByDesc('invoice_date')->take(3)->values()->all();

                $paymentProfit = (object) [
                    'total_received' => $totalPaid,
                    'tax_payable' => $totalTax,
                    'revenue_excl_tax' => $revenueExclTax,
                ];
            }
        }

        return view('reports.customer', compact(
            'customers',
            'customer',
            'summary',
            'invoiceBreakdown',
            'serviceBreakdown',
            'paymentProfit',
            'invoices'
        ));
    }

    public function exportPdf(Request $request)
    {
        $data = $this->getReportData($request);
        if (! $data) {
            return redirect()->route('reports.customers')->with('error', 'Select a customer and generate a report first.');
        }
        $pdf = Pdf::loadView('reports.export-pdf', $data);
        return $pdf->download("customer-report-{$data['customer']->name}.pdf");
    }

    public function exportExcel(Request $request): BinaryFileResponse|\Illuminate\Http\RedirectResponse
    {
        $data = $this->getReportData($request);
        if (! $data) {
            return redirect()->route('reports.customers')->with('error', 'Select a customer and generate a report first.');
        }
        $export = new CustomerReportExport($data['customer'], $data['invoices'], (array) $data['summary']);
        return Excel::download($export, "customer-report-{$data['customer']->name}.xlsx");
    }

    private function getReportData(Request $request): ?array
    {
        if (! $request->filled('customer_id')) {
            return null;
        }
        $customer = Customer::find((int) $request->customer_id);
        if (! $customer) {
            return null;
        }
        $query = $customer->invoices()->with('items.service', 'items.package', 'payments');
        if ($request->filled('from')) {
            $query->whereDate('invoice_date', '>=', $request->from);
        }
        if ($request->filled('to')) {
            $query->whereDate('invoice_date', '<=', $request->to);
        }
        $statusFilter = $request->input('status');
        if ($statusFilter !== null && $statusFilter !== '') {
            $query->where('status', $statusFilter);
        } else {
            $query->where('status', '!=', 'draft');
        }
        $invoices = $query->get();
        $totalBilled = $invoices->sum('grand_total');
        $totalTax = $invoices->sum('vat_amount');
        $totalPaid = $invoices->sum(fn ($i) => $i->payments->sum('amount'));
        $summary = (object) [
            'total_invoices' => $invoices->count(),
            'total_billed' => $totalBilled,
            'total_tax_collected' => $totalTax,
            'total_paid' => $totalPaid,
            'outstanding' => $totalBilled - $totalPaid,
            'total_profit' => $invoices->sum('subtotal_taxable') + $invoices->sum('subtotal_non_taxable'),
        ];
        $invoiceBreakdown = $invoices->map(fn ($inv) => (object) [
            'invoice' => $inv,
            'services_count' => $inv->items->count(),
            'payment_status' => $inv->status,
        ]);
        return compact('customer', 'invoices', 'summary', 'invoiceBreakdown');
    }
}
