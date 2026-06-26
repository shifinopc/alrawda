@extends('layouts.app')

@section('title', 'Invoices')
@section('subtitle', 'Create UAE VAT-compliant tax invoices')

@section('content')
  <div x-data="invoiceList()">
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
      <form method="GET" class="flex flex-col sm:flex-row flex-wrap gap-2 w-full lg:max-w-3xl" @submit="loading = true">
        <input class="input" name="search" value="{{ request('search') }}" placeholder="Search by invoice no or customer...">
        <input class="input sm:max-w-[140px]" type="date" name="from" value="{{ request('from') }}" placeholder="From">
        <input class="input sm:max-w-[140px]" type="date" name="to" value="{{ request('to') }}" placeholder="To">
        <select class="input sm:max-w-[180px]" name="status">
          <option value="">All statuses</option>
          <option value="draft" @selected(request('status')==='draft')>Draft</option>
          <option value="approved" @selected(request('status')==='approved')>Approved</option>
          <option value="partially_paid" @selected(request('status')==='partially_paid')>Partially Paid</option>
          <option value="paid" @selected(request('status')==='paid')>Paid</option>
          <option value="overdue" @selected(request('status')==='overdue')>Overdue</option>
        </select>
        <select class="input sm:max-w-[180px]" name="order">
          <option value="latest" @selected(request('order','latest')==='latest')>Latest first</option>
          <option value="oldest" @selected(request('order')==='oldest')>Oldest first</option>
        </select>
        <input type="hidden" name="sort" value="{{ request('sort', 'created_at') }}">
        <input type="hidden" name="dir" value="{{ request('order','latest')==='oldest' ? 'asc' : 'desc' }}">
        <button class="btn-ghost" type="submit">Filter</button>
      </form>
      @if(auth()->user()->isAdmin() || auth()->user()->canAccess('invoices', 'create'))
        <a class="btn-primary" href="{{ route('invoices.create') }}">Create Invoice</a>
      @endif
    </div>

    @php
      $sort = request('sort', 'created_at');
      $dir = request('dir', 'desc');
      $sortUrl = fn ($col, $d = null) => request()->fullUrlWithQuery(['sort' => $col, 'dir' => $d ?? ($sort === $col && $dir === 'desc' ? 'asc' : 'desc')]);
    @endphp

    @if($invoices->isNotEmpty())
    <div class="mb-3 flex flex-wrap items-center gap-2" x-show="selected.length > 0">
      <span class="text-sm text-slate-600" x-text="selected.length + ' selected'"></span>
      @if(auth()->user()->isAdmin() || auth()->user()->canAccess('invoices', 'approve'))
      <form method="POST" action="{{ route('invoices.bulk-approve') }}" class="inline">
        @csrf
        <template x-for="id in selected" :key="id">
          <input type="hidden" name="ids[]" :value="id">
        </template>
        <button class="btn-ghost text-sm" type="submit" :disabled="selected.length === 0">Bulk Approve</button>
      </form>
      @endif
      @if(auth()->user()->isAdmin() || auth()->user()->canAccess('invoices', 'delete'))
      <form method="POST" action="{{ route('invoices.bulk-delete') }}" class="inline" @submit="if(!confirm('Delete selected draft invoices?')) $event.preventDefault()">
        @csrf
        <template x-for="id in selected" :key="id">
          <input type="hidden" name="ids[]" :value="id">
        </template>
        <button class="btn-ghost text-sm text-rose-600" type="submit" :disabled="selected.length === 0">Bulk Delete</button>
      </form>
      @endif
      <button class="btn-ghost text-sm" @click="selected = []">Clear</button>
    </div>
    @endif

    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full table-auto text-sm">
          <thead>
            <tr>
              @if($invoices->isNotEmpty())
              <th class="table-th w-10">
                <input type="checkbox" @change="toggleAll($event)" :indeterminate="selected.length > 0 && selected.length < {{ $invoices->count() }}">
              </th>
              @endif
              <th class="table-th">
                <a href="{{ $sortUrl('invoice_number') }}" class="hover:text-brand-600" title="Sort by Invoice No">Invoice No</a>
              </th>
              <th class="table-th">
                <a href="{{ $sortUrl('invoice_date') }}" class="hover:text-brand-600" title="Sort by Date">Date</a>
              </th>
              <th class="table-th" title="Customer name">Customer</th>
              <th class="table-th hidden sm:table-cell" title="Taxable amount (AED)">Taxable</th>
              <th class="table-th hidden md:table-cell" title="Non-taxable amount (AED)">Non‑Taxable</th>
              <th class="table-th hidden lg:table-cell" title="VAT amount (AED)">VAT</th>
              <th class="table-th">
                <a href="{{ $sortUrl('grand_total') }}" class="hover:text-brand-600" title="Sort by Total">Total</a>
              </th>
              <th class="table-th">Status</th>
              <th class="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            @forelse($invoices as $inv)
              <tr class="table-row-hover transition-colors"
                  :class="{ 'bg-brand-50': selected.includes({{ $inv->id }}) }">
                @if($invoices->isNotEmpty())
                <td class="table-td">
                  @if($inv->status === 'draft')
                  <input type="checkbox" value="{{ $inv->id }}" @change="toggleSelect({{ $inv->id }}, $event)">
                  @else
                  <span class="text-slate-300">—</span>
                  @endif
                </td>
                @endif
                <td class="table-td font-semibold">{{ $inv->invoice_number }}</td>
                <td class="table-td">{{ $inv->invoice_date?->format('d M Y') }}</td>
                <td class="table-td">{{ $inv->customer->name }}</td>
                <td class="table-td hidden sm:table-cell">{{ number_format((float) $inv->subtotal_taxable, 2) }}</td>
                <td class="table-td hidden md:table-cell">{{ number_format((float) $inv->subtotal_non_taxable, 2) }}</td>
                <td class="table-td hidden lg:table-cell">{{ number_format((float) $inv->vat_amount, 2) }}</td>
                <td class="table-td font-semibold">{{ number_format((float) $inv->grand_total, 2) }}</td>
                <td class="table-td">
                  @php
                    $badge = match($inv->status) {
                      'approved' => 'bg-emerald-100 text-emerald-800 border-emerald-200 font-semibold',
                      'paid' => 'bg-emerald-50 text-emerald-700 border-emerald-100',
                      'partially_paid' => 'bg-amber-50 text-amber-700 border-amber-100',
                      default => 'bg-slate-50 text-slate-700 border-slate-100',
                    };
                  @endphp
                  <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold {{ $badge }}">
                    {{ ucfirst(str_replace('_', ' ', $inv->status)) }}
                  </span>
                </td>
                <td class="table-td text-right space-x-2">
                  <button
                    class="btn-ghost text-xs"
                    type="button"
                    @click="previewSrc = '{{ route('invoices.pdf', ['invoice' => $inv, 'preview' => 1]) }}'; previewOpen = true;"
                  >
                    View
                  </button>
                  @if($inv->status === 'draft' && (auth()->user()->isAdmin() || auth()->user()->canAccess('invoices', 'edit')))
                  <a class="btn-ghost text-xs" href="{{ route('invoices.edit', $inv) }}">Edit</a>
                  @endif
                  <a class="btn-ghost text-xs" href="{{ route('invoices.show', $inv) }}">Open</a>
                </td>
              </tr>
            @empty
              <tr>
                <td class="table-td text-center py-16" colspan="{{ $invoices->isEmpty() ? 9 : 10 }}">
                  <div class="flex flex-col items-center gap-3 text-slate-500">
                    <svg class="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <div class="font-semibold">No invoices yet</div>
                    <div class="text-sm">Create your first invoice to get started</div>
                    @if(auth()->user()->isAdmin() || auth()->user()->canAccess('invoices', 'create'))
                      <a class="btn-primary mt-2" href="{{ route('invoices.create') }}">Create Invoice</a>
                    @endif
                  </div>
                </td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 border-t border-slate-100">
        {{ $invoices->links() }}
      </div>
    </div>

    <div class="fixed inset-0 z-40" x-show="previewOpen" x-transition.opacity style="display:none"
         @keydown.escape.window="previewOpen = false">
      <div class="absolute inset-0 bg-slate-900/40" @click="previewOpen = false"></div>
      <div class="absolute inset-y-0 right-0 w-full max-w-3xl bg-white shadow-lift"
           x-transition:enter="transition duration-200 ease-in-out"
           x-transition:enter-start="translate-x-full opacity-0"
           x-transition:enter-end="translate-x-0 opacity-100"
           x-transition:leave="transition duration-200 ease-in-out"
           x-transition:leave-start="translate-x-0 opacity-100"
           x-transition:leave-end="translate-x-full opacity-0">
        <div class="h-full flex flex-col">
          <div class="px-4 sm:px-6 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold">Invoice Preview</div>
              <div class="text-xs text-slate-500">Quick preview</div>
            </div>
            <button class="btn-ghost text-xs" type="button" @click="previewOpen = false">Close</button>
          </div>
          <div class="flex-1 bg-slate-100">
            <iframe :src="previewSrc" class="w-full h-full border-0"></iframe>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function invoiceList() {
      return {
        selected: [],
        previewOpen: false,
        previewSrc: '',
        loading: false,
        toggleSelect(id, e) {
          if (e.target.checked) {
            this.selected.push(id);
          } else {
            this.selected = this.selected.filter(x => x !== id);
          }
        },
        toggleAll(e) {
          if (e.target.checked) {
            this.selected = Array.from(document.querySelectorAll('tbody input[type=checkbox][value]')).map(c => parseInt(c.value));
          } else {
            this.selected = [];
          }
        }
      };
    }
  </script>
@endsection
