<?php

namespace App\Http\Controllers;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\CompanySetting;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\View\View;
use Barryvdh\DomPDF\Facade\Pdf;

class DashboardController extends Controller
{
    public function index(Request $request): View
    {
        $from = $request->filled('from')
            ? Carbon::parse($request->from)->startOfDay()
            : now()->subMonths(5)->startOfMonth();
        $to = $request->filled('to')
            ? Carbon::parse($request->to)->endOfDay()
            : now()->endOfMonth();

        // Apply period presets
        if ($preset = $request->get('preset')) {
            $ranges = $this->presetRanges($preset);
            if ($ranges) {
                $from = $ranges['from'];
                $to = $ranges['to'];
            }
        }

        $baseQuery = fn () => Invoice::where('status', '!=', 'draft')
            ->whereDate('invoice_date', '>=', $from)
            ->whereDate('invoice_date', '<=', $to);

        $totalInvoices = (clone $baseQuery())->count();
        $totalRevenue = (float) (clone $baseQuery())->sum('grand_total');
        $vatCollected = (float) (clone $baseQuery())->sum('vat_amount');

        // Paid in period (payments for invoices in range)
        $invoiceIdsInRange = (clone $baseQuery())->pluck('id');
        $totalPaidInPeriod = (float) Payment::whereIn('invoice_id', $invoiceIdsInRange)->sum('amount');
        $outstanding = max(0, $totalRevenue - $totalPaidInPeriod);

        // Previous period for comparisons
        $periodLength = $from->diffInDays($to) + 1;
        $prevFrom = $from->copy()->subDays($periodLength);
        $prevTo = $from->copy()->subDay();
        $prevBaseQuery = fn () => Invoice::where('status', '!=', 'draft')
            ->whereDate('invoice_date', '>=', $prevFrom)
            ->whereDate('invoice_date', '<=', $prevTo);

        $prevTotalInvoices = (clone $prevBaseQuery())->count();
        $prevTotalRevenue = (float) (clone $prevBaseQuery())->sum('grand_total');
        $prevVatCollected = (float) (clone $prevBaseQuery())->sum('vat_amount');
        $prevInvoiceIds = (clone $prevBaseQuery())->pluck('id');
        $prevTotalPaid = (float) Payment::whereIn('invoice_id', $prevInvoiceIds)->sum('amount');
        $prevOutstanding = max(0, $prevTotalRevenue - $prevTotalPaid);

        $comparisons = [
            'invoices' => $this->percentChange($totalInvoices, $prevTotalInvoices),
            'revenue' => $this->percentChange($totalRevenue, $prevTotalRevenue),
            'vat' => $this->percentChange($vatCollected, $prevVatCollected),
            'outstanding' => $this->percentChange($outstanding, $prevOutstanding),
        ];

        // Quick stats
        $avgInvoiceValue = $totalInvoices > 0 ? $totalRevenue / $totalInvoices : 0;
        $paidInvoices = Invoice::where('status', 'paid')->whereNotNull('invoice_date');
        $avgDaysToPayment = 0;
        $paidWithDates = $paidInvoices->get();
        if ($paidWithDates->isNotEmpty()) {
            $days = $paidWithDates->map(function ($inv) {
                $lastPayment = $inv->payments()->orderByDesc('payment_date')->first();
                return $lastPayment && $inv->invoice_date
                    ? $inv->invoice_date->diffInDays($lastPayment->payment_date)
                    : 0;
            })->filter(fn ($d) => $d >= 0);
            $avgDaysToPayment = $days->isNotEmpty() ? round($days->avg(), 0) : 0;
        }
        $invoiceTrend = $comparisons['invoices'];

        // Revenue target
        $company = CompanySetting::first();
        $revenueTarget = $company?->revenue_target ? (float) $company->revenue_target : null;

        // Revenue per month
        $monthly = Invoice::selectRaw('DATE_FORMAT(invoice_date, "%Y-%m-01") as month_start, SUM(grand_total) as total')
            ->where('status', '!=', 'draft')
            ->whereNotNull('invoice_date')
            ->whereDate('invoice_date', '>=', $from)
            ->whereDate('invoice_date', '<=', $to)
            ->groupBy('month_start')
            ->orderBy('month_start')
            ->get();

        $labels = [];
        $values = [];
        $period = \Carbon\CarbonPeriod::create($from->copy()->startOfMonth(), '1 month', $to->copy()->endOfMonth());
        foreach ($period as $date) {
            $key = $date->format('Y-m-01');
            $labels[] = $date->format('M Y');
            $values[] = (float) ($monthly->firstWhere('month_start', $key)->total ?? 0);
        }

        // Revenue forecast (simple linear extrapolation for next month)
        $forecastValue = null;
        if (count($values) >= 2) {
            $lastTwo = array_slice($values, -2);
            $trend = $lastTwo[1] - $lastTwo[0];
            $forecastValue = max(0, end($values) + $trend);
        } elseif (count($values) === 1) {
            $forecastValue = $values[0];
        }

        $collectionBreakdown = [
            'paid' => max(0, $totalPaidInPeriod),
            'outstanding' => max(0, $outstanding),
        ];

        // Cash flow: revenue vs payments per month (full calendar year)
        $yearStart = now()->copy()->startOfYear();
        $yearEnd = now()->copy()->endOfYear();
        
        $yearlyMonthly = Invoice::selectRaw('DATE_FORMAT(invoice_date, "%Y-%m-01") as month_start, SUM(grand_total) as total')
            ->where('status', '!=', 'draft')
            ->whereNotNull('invoice_date')
            ->whereDate('invoice_date', '>=', $yearStart)
            ->whereDate('invoice_date', '<=', $yearEnd)
            ->groupBy('month_start')
            ->orderBy('month_start')
            ->get();

        $yearlyPaymentMonthly = Payment::selectRaw('DATE_FORMAT(payment_date, "%Y-%m-01") as month_start, SUM(amount) as total')
            ->whereDate('payment_date', '>=', $yearStart)
            ->whereDate('payment_date', '<=', $yearEnd)
            ->groupBy('month_start')
            ->orderBy('month_start')
            ->get();

        $cashFlowLabels = [];
        $cashFlowRevenue = [];
        $cashFlowPayments = [];
        $yearPeriod = \Carbon\CarbonPeriod::create($yearStart, '1 month', $yearEnd);
        foreach ($yearPeriod as $date) {
            $key = $date->format('Y-m-01');
            $cashFlowLabels[] = $date->format('M Y');
            $cashFlowRevenue[] = (float) ($yearlyMonthly->firstWhere('month_start', $key)->total ?? 0);
            $cashFlowPayments[] = (float) ($yearlyPaymentMonthly->firstWhere('month_start', $key)->total ?? 0);
        }

        // Overdue invoices (non-draft, due_date < today, outstanding > 0)
        $overdueInvoices = Invoice::with('customer')
            ->where('status', '!=', 'draft')
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<', now())
            ->get()
            ->filter(fn ($i) => $i->outstandingAmount() > 0)
            ->map(fn ($i) => [
                'invoice' => $i,
                'days_overdue' => now()->diffInDays($i->due_date, false) * -1,
                'outstanding' => $i->outstandingAmount(),
            ])
            ->sortByDesc('days_overdue')
            ->take(10)
            ->values();

        // Upcoming due dates (next 7–14 days)
        $upcomingDue = Invoice::with('customer')
            ->where('status', '!=', 'draft')
            ->whereIn('status', ['approved', 'partially_paid'])
            ->whereNotNull('due_date')
            ->whereDate('due_date', '>=', now())
            ->whereDate('due_date', '<=', now()->addDays(14))
            ->orderBy('due_date')
            ->take(10)
            ->get()
            ->filter(fn ($i) => $i->outstandingAmount() > 0);

        // Recent payments
        $recentPayments = Payment::with('invoice.customer')
            ->orderByDesc('payment_date')
            ->take(10)
            ->get();

        // Activity log (recent invoices + payments)
        $activities = collect();
        foreach ($recentPayments->take(5) as $p) {
            $activities->push([
                'type' => 'payment',
                'date' => $p->payment_date,
                'message' => 'Payment of ' . number_format((float) $p->amount, 2) . ' AED recorded for ' . ($p->invoice?->invoice_number ?? 'N/A'),
                'url' => $p->invoice ? route('invoices.show', $p->invoice) : null,
            ]);
        }
        $recentInvs = Invoice::with('customer')->where('status', '!=', 'draft')->latest()->take(5)->get();
        foreach ($recentInvs as $inv) {
            $activities->push([
                'type' => 'invoice',
                'date' => $inv->created_at,
                'message' => 'Invoice ' . $inv->invoice_number . ' created for ' . ($inv->customer?->name ?? 'N/A'),
                'url' => route('invoices.show', $inv),
            ]);
        }
        $activities = $activities->sortByDesc('date')->take(10)->values();

        // Invoice status distribution
        $statusQuery = Invoice::where('status', '!=', 'draft')
            ->whereDate('invoice_date', '>=', $from)
            ->whereDate('invoice_date', '<=', $to);
        $statusDistribution = [
            'approved' => (clone $statusQuery)->where('status', 'approved')->sum('grand_total'),
            'partially_paid' => (clone $statusQuery)->where('status', 'partially_paid')->sum('grand_total'),
            'paid' => (clone $statusQuery)->where('status', 'paid')->sum('grand_total'),
        ];
        $overdueAmount = Invoice::where('status', '!=', 'draft')
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<', now())
            ->get()
            ->sum(fn ($i) => $i->outstandingAmount());
        $statusDistribution['overdue'] = $overdueAmount;

        // Top services by revenue
        $topServices = \App\Models\InvoiceItem::with('service')
            ->join('invoices', 'invoice_items.invoice_id', '=', 'invoices.id')
            ->where('invoices.status', '!=', 'draft')
            ->whereDate('invoices.invoice_date', '>=', $from)
            ->whereDate('invoices.invoice_date', '<=', $to)
            ->selectRaw('invoice_items.service_id, SUM(invoice_items.line_total) as total')
            ->groupBy('invoice_items.service_id')
            ->orderByDesc('total')
            ->take(5)
            ->get();

        // Aging report (30/60/90 days overdue)
        $allOverdue = Invoice::where('status', '!=', 'draft')
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<', now())
            ->get();
        $aging = [
            '0_30' => 0,
            '31_60' => 0,
            '61_90' => 0,
            '90_plus' => 0,
        ];
        foreach ($allOverdue as $inv) {
            $amt = $inv->outstandingAmount();
            if ($amt <= 0) continue;
            $days = now()->diffInDays($inv->due_date);
            if ($days <= 30) $aging['0_30'] += $amt;
            elseif ($days <= 60) $aging['31_60'] += $amt;
            elseif ($days <= 90) $aging['61_90'] += $amt;
            else $aging['90_plus'] += $amt;
        }

        // Top customers (for pie + table)
        $topCustomers = Invoice::with('customer')
            ->where('status', '!=', 'draft')
            ->whereDate('invoice_date', '>=', $from)
            ->whereDate('invoice_date', '<=', $to)
            ->selectRaw('customer_id, SUM(grand_total) as total, COUNT(*) as invoices_count')
            ->groupBy('customer_id')
            ->orderByDesc('total')
            ->take(5)
            ->get();

        // Alerts
        $overdueCount = $overdueInvoices->count();
        $alertOverdue = $overdueCount > 0;

        return view('dashboard', compact(
            'totalInvoices',
            'totalRevenue',
            'vatCollected',
            'outstanding',
            'labels',
            'values',
            'forecastValue',
            'collectionBreakdown',
            'topCustomers',
            'from',
            'to',
            'comparisons',
            'avgInvoiceValue',
            'avgDaysToPayment',
            'invoiceTrend',
            'revenueTarget',
            'cashFlowLabels',
            'cashFlowRevenue',
            'cashFlowPayments',
            'overdueInvoices',
            'upcomingDue',
            'recentPayments',
            'activities',
            'statusDistribution',
            'topServices',
            'aging',
            'alertOverdue',
            'overdueCount',
        ));
    }

    private function presetRanges(string $preset): ?array
    {
        $now = now();
        return match ($preset) {
            'this_month' => ['from' => $now->copy()->startOfMonth(), 'to' => $now->copy()->endOfMonth()],
            'last_month' => ['from' => $now->copy()->subMonth()->startOfMonth(), 'to' => $now->copy()->subMonth()->endOfMonth()],
            'this_quarter' => ['from' => $now->copy()->startOfQuarter(), 'to' => $now->copy()->endOfQuarter()],
            'this_year' => ['from' => $now->copy()->startOfYear(), 'to' => $now->copy()->endOfYear()],
            default => null,
        };
    }

    private function percentChange(float $current, float $previous): ?float
    {
        if ($previous == 0) return $current > 0 ? 100 : null;
        return round((($current - $previous) / $previous) * 100, 1);
    }

    public function exportPdf(Request $request)
    {
        $from = $request->filled('from') ? Carbon::parse($request->from)->startOfDay() : now()->subMonths(5)->startOfMonth();
        $to = $request->filled('to') ? Carbon::parse($request->to)->endOfDay() : now()->endOfMonth();

        $baseQuery = fn () => Invoice::where('status', '!=', 'draft')
            ->whereDate('invoice_date', '>=', $from)
            ->whereDate('invoice_date', '<=', $to);

        $totalInvoices = (clone $baseQuery())->count();
        $totalRevenue = (float) (clone $baseQuery())->sum('grand_total');
        $vatCollected = (float) (clone $baseQuery())->sum('vat_amount');
        $invoiceIdsInRange = (clone $baseQuery())->pluck('id');
        $totalPaidInPeriod = (float) Payment::whereIn('invoice_id', $invoiceIdsInRange)->sum('amount');
        $outstanding = max(0, $totalRevenue - $totalPaidInPeriod);

        $company = CompanySetting::first();
        $data = [
            'totalInvoices' => $totalInvoices,
            'totalRevenue' => $totalRevenue,
            'vatCollected' => $vatCollected,
            'outstanding' => $outstanding,
            'from' => $from,
            'to' => $to,
            'company' => $company,
        ];

        $pdf = Pdf::loadView('dashboard.export-pdf', $data)->setPaper('a4', 'portrait');
        return $pdf->download('dashboard-summary-' . now()->format('Y-m-d') . '.pdf');
    }
}
