@extends('layouts.app')

@section('title', 'Customer Reports')
@section('subtitle', 'Invoice, service, VAT and payment analysis')

@section('content')
  <div class="card p-5">
    <form method="GET" action="{{ route('reports.customers') }}" class="grid grid-cols-1 lg:grid-cols-5 gap-3 items-end">
      <div class="lg:col-span-2">
        <label class="label">Customer</label>
        <select class="input mt-1" name="customer_id" required>
          <option value="">Select customer...</option>
          @foreach($customers as $c)
            <option value="{{ $c->id }}" @selected(request('customer_id')==$c->id)>{{ $c->name }}</option>
          @endforeach
        </select>
      </div>
      <div>
        <label class="label">From</label>
        <input class="input mt-1" type="date" name="from" value="{{ request('from') }}">
      </div>
      <div>
        <label class="label">To</label>
        <input class="input mt-1" type="date" name="to" value="{{ request('to') }}">
      </div>
      <div>
        <label class="label">Status</label>
        <select class="input mt-1" name="status">
          <option value="">Approved & beyond (default)</option>
          <option value="approved" @selected(request('status')==='approved')>Approved</option>
          <option value="draft" @selected(request('status')==='draft')>Draft</option>
          <option value="partially_paid" @selected(request('status')==='partially_paid')>Partially Paid</option>
          <option value="paid" @selected(request('status')==='paid')>Paid</option>
        </select>
      </div>
      <div class="lg:col-span-5 flex flex-wrap justify-end gap-2">
        <a class="btn-ghost" href="{{ route('reports.customers') }}">Reset</a>
        <button class="btn-primary" type="submit">Generate</button>
      </div>
    </form>
  </div>

  @if($customer && $summary)
    <div class="mt-4 flex flex-wrap gap-2">
      <a href="{{ route('reports.export-pdf', request()->query()) }}" class="btn-ghost text-sm">Export PDF</a>
      <a href="{{ route('reports.export-excel', request()->query()) }}" class="btn-ghost text-sm">Export Excel</a>
    </div>
    <div class="mt-4 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
      @php
        $kpis = [
          ['label' => 'Total Invoices', 'value' => (int) $summary->total_invoices],
          ['label' => 'Total Billed (AED)', 'value' => (float) $summary->total_billed],
          ['label' => 'Tax Collected (AED)', 'value' => (float) $summary->total_tax_collected],
          ['label' => 'Total Paid (AED)', 'value' => (float) $summary->total_paid],
          ['label' => 'Outstanding (AED)', 'value' => (float) $summary->outstanding],
          ['label' => 'Total Profit (AED)', 'value' => (float) $summary->total_profit],
        ];
      @endphp
      @foreach($kpis as $k)
        <div class="card p-5 transition duration-200 ease-in-out hover:shadow-lift">
          <div class="text-xs font-semibold text-slate-500">{{ $k['label'] }}</div>
          <div class="mt-2 text-xl font-bold">{{ number_format((float) $k['value'], is_int($k['value']) ? 0 : 2) }}</div>
        </div>
      @endforeach
    </div>

    <div class="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100">
          <div class="text-sm font-semibold">Invoice-level Breakdown</div>
          <div class="text-xs text-slate-500">Traceability from customer → invoice.</div>
        </div>
        <div class="overflow-auto max-h-[520px]">
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="table-th">Invoice</th>
                <th class="table-th">Date</th>
                <th class="table-th">Services</th>
                <th class="table-th">Taxable</th>
                <th class="table-th">Non‑Taxable</th>
                <th class="table-th">VAT</th>
                <th class="table-th">Total</th>
                <th class="table-th">Status</th>
              </tr>
            </thead>
            <tbody>
              @foreach($invoiceBreakdown as $row)
                <tr class="hover:bg-slate-50 transition">
                  <td class="table-td font-semibold">
                    <a class="text-brand-700 hover:underline" href="{{ route('invoices.show', $row->invoice) }}">{{ $row->invoice->invoice_number }}</a>
                  </td>
                  <td class="table-td">{{ $row->invoice->invoice_date?->format('d M Y') }}</td>
                  <td class="table-td">{{ $row->services_count }}</td>
                  <td class="table-td">{{ number_format((float) $row->invoice->subtotal_taxable, 2) }}</td>
                  <td class="table-td">{{ number_format((float) $row->invoice->subtotal_non_taxable, 2) }}</td>
                  <td class="table-td">{{ number_format((float) $row->invoice->vat_amount, 2) }}</td>
                  <td class="table-td font-semibold">{{ number_format((float) $row->invoice->grand_total, 2) }}</td>
                  <td class="table-td">
                    @php
                      $status = $row->payment_status;
                      $statusLabel = ucfirst(str_replace('_', ' ', $status));
                      $badge = match($status) {
                        'approved' => 'bg-emerald-100 text-emerald-800 border-emerald-200 font-semibold',
                        'paid' => 'bg-emerald-50 text-emerald-700 border-emerald-100',
                        'partially_paid' => 'bg-amber-50 text-amber-700 border-amber-100',
                        default => 'bg-slate-50 text-slate-600 border-slate-100',
                      };
                    @endphp
                    <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs {{ $badge }}">{{ $statusLabel }}</span>
                  </td>
                </tr>
              @endforeach
            </tbody>
          </table>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100">
          <div class="text-sm font-semibold">Service-level Breakdown</div>
          <div class="text-xs text-slate-500">Most important: customer → invoice → service.</div>
        </div>
        <div class="overflow-auto max-h-[520px]">
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="table-th">Service</th>
                <th class="table-th">Invoice</th>
                <th class="table-th">Qty</th>
                <th class="table-th">Taxable</th>
                <th class="table-th">Non‑Taxable</th>
                <th class="table-th">VAT</th>
                <th class="table-th">Line Total</th>
              </tr>
            </thead>
            <tbody>
              @foreach($serviceBreakdown as $row)
                <tr class="hover:bg-slate-50 transition">
                  <td class="table-td font-semibold">{{ $row->service_name }}</td>
                  <td class="table-td">{{ $row->invoice_number }}</td>
                  <td class="table-td">{{ $row->quantity }}</td>
                  <td class="table-td">{{ number_format((float) $row->taxable_amount, 2) }}</td>
                  <td class="table-td">{{ number_format((float) $row->non_taxable_amount, 2) }}</td>
                  <td class="table-td">{{ number_format((float) $row->tax_amount, 2) }}</td>
                  <td class="table-td font-semibold">{{ number_format((float) $row->line_total, 2) }}</td>
                </tr>
              @endforeach
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="mt-4 card p-5">
      <div class="text-sm font-semibold">Payment & Profit Analysis</div>
      <div class="text-xs text-slate-500">Accountant-friendly totals.</div>
      <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="rounded-lg bg-slate-50 border border-slate-100 p-4">
          <div class="text-xs font-semibold text-slate-500">Total Received</div>
          <div class="mt-1 text-lg font-bold">{{ number_format((float) $paymentProfit->total_received, 2) }} AED</div>
        </div>
        <div class="rounded-lg bg-slate-50 border border-slate-100 p-4">
          <div class="text-xs font-semibold text-slate-500">Tax Payable</div>
          <div class="mt-1 text-lg font-bold">{{ number_format((float) $paymentProfit->tax_payable, 2) }} AED</div>
        </div>
        <div class="rounded-lg bg-slate-50 border border-slate-100 p-4">
          <div class="text-xs font-semibold text-slate-500">Revenue (Excl. Tax)</div>
          <div class="mt-1 text-lg font-bold">{{ number_format((float) $paymentProfit->revenue_excl_tax, 2) }} AED</div>
        </div>
      </div>
    </div>
  @endif
@endsection

