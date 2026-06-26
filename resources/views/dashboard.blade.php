@extends('layouts.app')

@section('title', 'Dashboard')
@section('subtitle', 'Business overview')

@section('content')
<div x-data="{ loading: false }" class="min-w-0 overflow-x-hidden">
  {{-- Alerts --}}
  @if($alertOverdue ?? false)
    <div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-amber-600">⚠</span>
        <span class="text-sm font-semibold text-amber-800">{{ $overdueCount }} overdue {{ Str::plural('invoice', $overdueCount) }} require attention.</span>
      </div>
      <a class="text-sm font-semibold text-amber-700 hover:underline" href="{{ route('invoices.index', ['status' => 'overdue']) }}">View →</a>
    </div>
  @endif

  {{-- Date filter: auto-applies on date select, Clear to reset --}}
  <form method="GET" id="dashboardFilter" class="mb-4 flex flex-wrap gap-2 items-end">
    <div>
      <label class="label text-xs">From</label>
      <input type="date" name="from" class="input mt-1 text-sm" value="{{ request('from', $from?->format('Y-m-d')) }}" @change="document.getElementById('dashboardFilter').submit()">
    </div>
    <div>
      <label class="label text-xs">To</label>
      <input type="date" name="to" class="input mt-1 text-sm" value="{{ request('to', $to?->format('Y-m-d')) }}" @change="document.getElementById('dashboardFilter').submit()">
    </div>
    <a class="btn-ghost text-xs" href="{{ route('dashboard') }}">Clear</a>
    <span class="text-xs text-slate-400 ml-auto">Last updated: {{ now()->format('d M Y H:i') }}</span>
  </form>

  {{-- KPI cards with comparisons --}}
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
    @php
      $cards = [
        ['label' => 'Total Invoices', 'value' => (int) $totalInvoices, 'comp' => $comparisons['invoices'] ?? null, 'link' => route('invoices.index', ['from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d')]), 'accent' => 'border-l-4 border-brand-500 bg-brand-50'],
        ['label' => 'Total Revenue (AED)', 'value' => (float) $totalRevenue, 'comp' => $comparisons['revenue'] ?? null, 'link' => null, 'accent' => 'border-l-4 border-emerald-500 bg-emerald-50'],
        ['label' => 'VAT Collected (AED)', 'value' => (float) $vatCollected, 'comp' => $comparisons['vat'] ?? null, 'link' => null, 'accent' => 'border-l-4 border-sky-500 bg-sky-50'],
        ['label' => 'Outstanding (AED)', 'value' => (float) $outstanding, 'comp' => $comparisons['outstanding'] ?? null, 'link' => null, 'accent' => 'border-l-4 border-amber-500 bg-amber-50'],
      ];
    @endphp

    @foreach($cards as $card)
      <a href="{{ $card['link'] ?? '#' }}" class="{{ $card['link'] ? 'hover:shadow-lift' : 'pointer-events-none' }} block">
        <div class="card p-5 transition duration-200 ease-in-out {{ $card['accent'] }}"
             x-data="{ current: 0, target: {{ json_encode($card['value']) }} }"
             x-init="
               const isInt = Number.isInteger(target);
               const duration = 650;
               const start = performance.now();
               const tick = (now) => {
                 const p = Math.min(1, (now - start) / duration);
                 const eased = 1 - Math.pow(1 - p, 3);
                 const v = target * eased;
                 current = isInt ? Math.round(v) : Math.round(v * 100) / 100;
                 if (p < 1) requestAnimationFrame(tick);
               };
               requestAnimationFrame(tick);
             "
        >
          <div class="flex justify-between items-start">
            <span class="text-xs font-semibold text-slate-500">{{ $card['label'] }}</span>
            @if($card['comp'] !== null)
              @php
                $up = in_array($card['label'], ['Total Invoices', 'Total Revenue (AED)', 'VAT Collected (AED)']) ? $card['comp'] >= 0 : $card['comp'] <= 0;
              @endphp
              <span class="text-xs font-semibold {{ $up ? 'text-emerald-600' : 'text-rose-600' }}">
                {{ $card['comp'] > 0 ? '+' : '' }}{{ $card['comp'] }}%
              </span>
            @endif
          </div>
          <div class="mt-2 text-2xl font-bold tracking-tight" x-text="current.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(target) ? 0 : 2, maximumFractionDigits: Number.isInteger(target) ? 0 : 2 })"></div>
        </div>
      </a>
    @endforeach
  </div>

  {{-- Target vs actual (optional) --}}
  @if($revenueTarget && $revenueTarget > 0)
  <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="card p-5 border-l-4 border-violet-500 bg-violet-50">
        <div class="text-xs font-semibold text-slate-500">Revenue Target (AED)</div>
        @php
          $pct = min(100, round(($totalRevenue / $revenueTarget) * 100, 1));
        @endphp
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-2xl font-bold">{{ number_format($totalRevenue, 2) }}</span>
          <span class="text-sm text-slate-500">/ {{ number_format($revenueTarget, 2) }}</span>
        </div>
        <div class="mt-3 h-2 rounded-full bg-violet-200 overflow-hidden">
          <div class="h-full rounded-full bg-violet-600 transition-all" style="width: {{ $pct }}%"></div>
        </div>
        <div class="mt-1 text-xs text-slate-500">{{ $pct }}% of target</div>
      </div>
  </div>
  @endif

  {{-- Revenue Overview + Collections + Invoice status --}}
  <div class="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="text-sm font-semibold">Revenue Overview</div>
          <div class="text-xs text-slate-500">Invoice revenue by month{{ $forecastValue !== null ? ' with next month forecast' : '' }}.</div>
        </div>
      </div>
      <div class="h-[200px] min-w-0 relative">
        <canvas id="revenueChart"></canvas>
      </div>
    </div>

    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="text-sm font-semibold">Collections</div>
          <div class="text-xs text-slate-500">Paid vs outstanding amounts.</div>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <div class="w-40 h-40 shrink-0">
          <canvas id="collectionChart"></canvas>
        </div>
        <div class="flex-1 space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-brand-500"></span>
              <span class="text-slate-600">Paid</span>
            </div>
            <span class="font-semibold">{{ number_format($collectionBreakdown['paid'], 2) }} AED</span>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
              <span class="text-slate-600">Outstanding</span>
            </div>
            <span class="font-semibold">{{ number_format($collectionBreakdown['outstanding'], 2) }} AED</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card p-5">
      <div class="text-sm font-semibold mb-4">Cash Flow</div>
      <div class="text-xs text-slate-500 mb-2">Revenue vs payments by month.</div>
      <div class="h-[180px] relative">
        <canvas id="cashFlowChart"></canvas>
      </div>
    </div>
  </div>

  {{-- Aging report --}}
  <div class="mt-6">
    <div class="card p-5">
      <div class="text-sm font-semibold mb-4">Aging Report</div>
      <div class="text-xs text-slate-500 mb-3">Outstanding by days overdue.</div>
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="rounded-lg bg-slate-50 p-3">
          <div class="text-xs text-slate-500">0-30 days</div>
          <div class="font-semibold">{{ number_format($aging['0_30'] ?? 0, 2) }}</div>
        </div>
        <div class="rounded-lg bg-amber-50 p-3">
          <div class="text-xs text-slate-500">31-60 days</div>
          <div class="font-semibold">{{ number_format($aging['31_60'] ?? 0, 2) }}</div>
        </div>
        <div class="rounded-lg bg-orange-50 p-3">
          <div class="text-xs text-slate-500">61-90 days</div>
          <div class="font-semibold">{{ number_format($aging['61_90'] ?? 0, 2) }}</div>
        </div>
        <div class="rounded-lg bg-rose-50 p-3">
          <div class="text-xs text-slate-500">90+ days</div>
          <div class="font-semibold">{{ number_format($aging['90_plus'] ?? 0, 2) }}</div>
        </div>
      </div>
    </div>
  </div>

  {{-- Overdue + Upcoming due + Recent payments --}}
  <div class="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100">
        <div class="text-sm font-semibold">Overdue Invoices</div>
        <div class="text-xs text-slate-500">Past due with outstanding balance.</div>
      </div>
      <div class="overflow-auto max-h-[280px]">
        <table class="min-w-full">
          <thead>
            <tr>
              <th class="table-th">Invoice</th>
              <th class="table-th">Days</th>
              <th class="table-th">Outstanding</th>
              <th class="table-th"></th>
            </tr>
          </thead>
          <tbody>
            @forelse($overdueInvoices ?? [] as $item)
              <tr class="hover:bg-slate-50 transition">
                <td class="table-td font-semibold">{{ $item['invoice']->invoice_number }}</td>
                <td class="table-td text-amber-600">{{ $item['days_overdue'] }} days</td>
                <td class="table-td">{{ number_format($item['outstanding'], 2) }} AED</td>
                <td class="table-td text-right">
                  <a class="text-brand-700 font-semibold hover:underline" href="{{ route('invoices.show', $item['invoice']) }}">View</a>
                </td>
              </tr>
            @empty
              <tr>
                <td class="table-td text-slate-500 py-8 text-center" colspan="4">
                  <p>No overdue invoices.</p>
                  <a href="{{ route('invoices.index') }}" class="text-brand-600 hover:underline text-sm mt-1 inline-block">View all invoices</a>
                </td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100">
        <div class="text-sm font-semibold">Upcoming Due Dates</div>
        <div class="text-xs text-slate-500">Next 14 days.</div>
      </div>
      <div class="overflow-auto max-h-[280px]">
        <table class="min-w-full">
          <thead>
            <tr>
              <th class="table-th">Invoice</th>
              <th class="table-th">Due</th>
              <th class="table-th">Outstanding</th>
              <th class="table-th"></th>
            </tr>
          </thead>
          <tbody>
            @forelse($upcomingDue ?? [] as $inv)
              <tr class="hover:bg-slate-50 transition">
                <td class="table-td font-semibold">{{ $inv->invoice_number }}</td>
                <td class="table-td">{{ $inv->due_date?->format('d M Y') }}</td>
                <td class="table-td">{{ number_format($inv->outstandingAmount(), 2) }} AED</td>
                <td class="table-td text-right">
                  <a class="text-brand-700 font-semibold hover:underline" href="{{ route('invoices.show', $inv) }}">View</a>
                </td>
              </tr>
            @empty
              <tr>
                <td class="table-td text-slate-500 py-8 text-center" colspan="4">
                  <p>No invoices due in the next 14 days.</p>
                </td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100">
        <div class="text-sm font-semibold">Recent Payments</div>
        <div class="text-xs text-slate-500">Last 10 payments.</div>
      </div>
      <div class="overflow-auto max-h-[280px]">
        <table class="min-w-full">
          <thead>
            <tr>
              <th class="table-th">Date</th>
              <th class="table-th">Amount</th>
              <th class="table-th">Invoice</th>
              <th class="table-th"></th>
            </tr>
          </thead>
          <tbody>
            @forelse($recentPayments ?? [] as $p)
              <tr class="hover:bg-slate-50 transition">
                <td class="table-td">{{ $p->payment_date?->format('d M Y') }}</td>
                <td class="table-td font-semibold">{{ number_format((float) $p->amount, 2) }} AED</td>
                <td class="table-td">{{ $p->invoice?->invoice_number ?? '-' }}</td>
                <td class="table-td text-right">
                  @if($p->invoice)
                    <a class="text-brand-700 font-semibold hover:underline" href="{{ route('invoices.show', $p->invoice) }}">View</a>
                  @endif
                </td>
              </tr>
            @empty
              <tr>
                <td class="table-td text-slate-500 py-8 text-center" colspan="4">
                  <p>No payments recorded yet.</p>
                  <a href="{{ route('payments.create') }}" class="text-brand-600 hover:underline text-sm mt-1 inline-block">Record payment</a>
                </td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>
    </div>
  </div>

  {{-- Activity log + Top Customers --}}
  <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100">
        <div class="text-sm font-semibold">Activity</div>
        <div class="text-xs text-slate-500">Recent actions.</div>
      </div>
      <div class="overflow-auto max-h-[280px] divide-y divide-slate-100">
        @forelse($activities ?? [] as $a)
          <div class="px-5 py-3 hover:bg-slate-50">
            <div class="text-xs text-slate-500">{{ $a['date'] instanceof \Carbon\Carbon ? $a['date']->format('d M H:i') : \Carbon\Carbon::parse($a['date'])->format('d M H:i') }}</div>
            @if($a['url'] ?? null)
              <a href="{{ $a['url'] }}" class="text-sm text-slate-700 hover:text-brand-600">{{ $a['message'] }}</a>
            @else
              <span class="text-sm text-slate-700">{{ $a['message'] }}</span>
            @endif
          </div>
        @empty
          <div class="px-5 py-8 text-slate-500 text-sm text-center">
            <p>No recent activity.</p>
            <a href="{{ route('invoices.create') }}" class="text-brand-600 hover:underline text-sm mt-1 inline-block">Create your first invoice</a>
          </div>
        @endforelse
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold">Top Customers</div>
          <div class="text-xs text-slate-500">By total invoiced amount.</div>
        </div>
      </div>
      <div class="overflow-auto max-h-[280px]">
        <table class="min-w-full">
          <thead>
            <tr>
              <th class="table-th">Customer</th>
              <th class="table-th">Invoices</th>
              <th class="table-th">Total (AED)</th>
            </tr>
          </thead>
          <tbody>
            @forelse($topCustomers as $row)
              <tr class="hover:bg-slate-50 transition">
                <td class="table-td font-semibold">{{ $row->customer?->name ?? 'Unknown' }}</td>
                <td class="table-td">{{ $row->invoices_count }}</td>
                <td class="table-td font-semibold">{{ number_format((float) $row->total, 2) }}</td>
              </tr>
            @empty
              <tr>
                <td class="table-td text-slate-500 py-8 text-center" colspan="3">
                  <p>No customer data yet.</p>
                  <a href="{{ route('customers.index') }}" class="text-brand-600 hover:underline text-sm mt-1 inline-block">Add customers</a>
                </td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  const labels = @json($labels);
  const values = @json($values);
  const forecastValue = @json($forecastValue);
  const collectionBreakdown = @json($collectionBreakdown);
  const cashFlowLabels = @json($cashFlowLabels ?? []);
  const cashFlowRevenue = @json($cashFlowRevenue ?? []);
  const cashFlowPayments = @json($cashFlowPayments ?? []);

  // Revenue chart with optional forecast
  const revenueCtx = document.getElementById('revenueChart').getContext('2d');
  const revLabels = forecastValue !== null ? [...labels, 'Forecast'] : labels;
  const revData = forecastValue !== null ? [...values, forecastValue] : values;
  const revBg = values.map(() => 'rgba(99, 102, 241, 0.3)');
  const revBorder = values.map(() => 'rgba(79, 70, 229, 1)');
  if (forecastValue !== null) {
    revBg.push('rgba(148, 163, 184, 0.15)');
    revBorder.push('rgba(100, 116, 139, 0.6)');
  }

  new Chart(revenueCtx, {
    type: 'bar',
    data: {
      labels: revLabels,
      datasets: [{
        label: 'Revenue (AED)',
        data: revData,
        backgroundColor: revBg,
        borderColor: revBorder,
        borderWidth: 2,
        borderRadius: 6,
        maxBarThickness: 40,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 11 } } },
        y: { grid: { color: 'rgba(99, 102, 241, 0.1)' }, ticks: { color: '#64748b', font: { size: 11 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label(ctx) { return 'Revenue: ' + ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2 }) + ' AED'; } }
        }
      }
    }
  });

  // Collections
  const collectionCtx = document.getElementById('collectionChart').getContext('2d');
  new Chart(collectionCtx, {
    type: 'doughnut',
    data: {
      labels: ['Paid', 'Outstanding'],
      datasets: [{ data: [collectionBreakdown.paid, collectionBreakdown.outstanding], backgroundColor: ['#6366f1', '#10b981'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
  });

  // Cash flow
  const cashCtx = document.getElementById('cashFlowChart');
  if (cashCtx) {
    new Chart(cashCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: cashFlowLabels,
        datasets: [
          { label: 'Revenue', data: cashFlowRevenue, backgroundColor: 'rgba(99, 102, 241, 0.4)', borderColor: '#4f46e5', borderWidth: 2, borderRadius: 4 },
          { label: 'Payments', data: cashFlowPayments, backgroundColor: 'rgba(165, 180, 252, 0.4)', borderColor: '#818cf8', borderWidth: 2, borderRadius: 4 },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } },
          y: { grid: { color: 'rgba(99, 102, 241, 0.1)' }, ticks: { color: '#64748b' } },
        },
        plugins: { legend: { position: 'top' } }
      }
    });
  }

});
</script>
@endsection
