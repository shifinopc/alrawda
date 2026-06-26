@extends('layouts.app')

@section('title', 'Payments')
@section('subtitle', 'Track payments and references')

@section('content')
  <div x-data="{ recordModalOpen: {{ $errors->any() ? 'true' : 'false' }}, receiptOpen: false, receiptSrc: '' }">
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
      <div></div>
      <div class="flex gap-2">
        @if(auth()->user()->isAdmin() || auth()->user()->canAccess('payments', 'create'))
          <button type="button" class="btn-ghost" @click="$dispatch('open-advance-modal')">Record Advance</button>
          <button type="button" class="btn-primary" @click="recordModalOpen = true">Record Payment</button>
        @endif
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100">
        <div class="text-sm font-semibold">Recent Payments</div>
        <div class="text-xs text-slate-500">Payments recorded against invoices.</div>
      </div>

      <div class="overflow-x-auto overflow-y-auto max-h-[720px]">
        <table class="min-w-full text-sm">
          <thead>
            <tr>
              <th class="table-th">Payment No</th>
              <th class="table-th">Date</th>
              <th class="table-th">Invoice / Type</th>
              <th class="table-th">Customer</th>
              <th class="table-th hidden sm:table-cell">Method</th>
              <th class="table-th hidden lg:table-cell">Reference</th>
              <th class="table-th">Amount (AED)</th>
              <th class="table-th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
              @forelse($payments as $p)
              <tr class="table-row-hover transition-colors">
                <td class="table-td font-medium">{{ $p->payment_number ?? '—' }}</td>
                <td class="table-td">{{ $p->payment_date?->format('d M Y') }}</td>
                <td class="table-td font-semibold">
                  @if($p->is_advance)
                    <span class="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                      Customer Advance
                    </span>
                  @elseif($p->invoice)
                    <a class="text-brand-700 hover:underline" href="{{ route('invoices.show', $p->invoice) }}">
                      {{ $p->invoice->invoice_number }}
                    </a>
                  @else
                    —
                  @endif
                </td>
                <td class="table-td">
                  {{ optional($p->customer ?? optional($p->invoice)->customer)->name ?? '—' }}
                </td>
                <td class="table-td hidden sm:table-cell">{{ $p->payment_method ?? ($p->is_advance ? 'Advance' : '—') }}</td>
                <td class="table-td hidden lg:table-cell">{{ $p->reference ?? '—' }}</td>
                <td class="table-td font-semibold">{{ number_format((float) $p->amount, 2) }}</td>
                <td class="table-td text-right space-x-2">
                  <button
                    class="btn-ghost text-xs"
                    type="button"
                    @click="receiptSrc = '{{ route('payments.receipt', $p) }}?preview=1'; receiptOpen = true;"
                  >
                    View Receipt
                  </button>
                  @php
                    $canDeleteAdvance = $p->is_advance && ($p->remaining_amount === null || (float) $p->remaining_amount === (float) $p->amount);
                    $canDelete = ! $p->is_advance || $canDeleteAdvance;
                  @endphp
                  @if($canDelete && (auth()->user()->isAdmin() || auth()->user()->canAccess('payments', 'delete')))
                    <form method="POST" action="{{ route('payments.destroy', $p) }}" class="inline"
                          onsubmit="return confirm('Delete this payment? This cannot be undone.')">
                      @csrf
                      @method('DELETE')
                      <button type="submit" class="btn-ghost text-xs text-rose-600">
                        Delete
                      </button>
                    </form>
                  @endif
                </td>
              </tr>
            @empty
              <tr>
                <td class="table-td text-center py-16" colspan="8">
                  <div class="flex flex-col items-center gap-3 text-slate-500">
                    <svg class="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>
                    </svg>
                    <div class="font-semibold">No payments yet</div>
                    <div class="text-sm">Click Record Payment to add your first payment</div>
                  </div>
                </td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>

      <div class="px-4 py-3 border-t border-slate-100">
        {{ $payments->links() }}
      </div>
    </div>

    <!-- Record Payment Modal -->
    <div class="fixed inset-0 z-50" x-show="recordModalOpen" 
         x-transition:enter="transition ease-out duration-200"
         x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100"
         x-transition:leave="transition ease-in duration-150" 
         x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0"
         @keydown.escape.window="recordModalOpen = false"
         style="display: none;">
      <div class="absolute inset-0 bg-slate-900/50" @click="recordModalOpen = false"></div>
      <div class="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
        <div class="relative w-full max-w-lg my-8 bg-white rounded-2xl shadow-xl flex flex-col max-h-[calc(100vh-4rem)]"
             @click.stop
             x-transition:enter="transition ease-out duration-200"
             x-transition:enter-start="opacity-0 scale-95" x-transition:enter-end="opacity-100 scale-100"
             x-transition:leave="transition ease-in duration-150"
             x-transition:leave-start="opacity-100 scale-100" x-transition:leave-end="opacity-0 scale-95">
          <div class="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
            <h3 class="text-lg font-semibold text-slate-900">Record Payment</h3>
            <button type="button" class="p-2 rounded-full hover:bg-slate-100 text-slate-500" @click="recordModalOpen = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <form method="POST" action="{{ route('payments.store') }}" class="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
            @csrf
            <div>
              <label class="label" for="record-payment-invoice">Invoice</label>
              <select name="invoice_id" id="record-payment-invoice" class="input mt-1 w-full" required>
                <option value="" disabled @selected(!old('invoice_id'))>Choose an invoice</option>
                @foreach($invoices as $inv)
                  @php $outstanding = (float) $inv->grand_total - $inv->payments->sum('amount'); @endphp
                  <option value="{{ $inv->id }}" @selected(old('invoice_id')==$inv->id)>
                    {{ $inv->invoice_number }} – {{ Str::limit($inv->customer->name, 25) }} ({{ number_format($outstanding, 2) }} AED)
                  </option>
                @endforeach
              </select>
              @if($invoices->isEmpty())
                <p class="text-sm text-slate-500 mt-1">No invoices with outstanding balance.</p>
              @endif
            </div>
            <div>
              <label class="label">Amount (AED)</label>
              <input name="amount" type="number" step="0.01" min="0.01" class="input mt-1" placeholder="0.00" value="{{ old('amount') }}" required>
              @error('amount')
                <p class="mt-1 text-sm text-rose-600">{{ $message }}</p>
              @enderror
            </div>
            <div>
              <label class="label">Payment Date</label>
              <input name="payment_date" type="date" class="input mt-1" value="{{ old('payment_date', now()->toDateString()) }}" required>
            </div>
            <div>
              <label class="label">Payment Method (optional)</label>
              <input name="payment_method" type="text" class="input mt-1" placeholder="e.g. Bank Transfer, Cash" value="{{ old('payment_method') }}">
            </div>
            <div>
              <label class="label">Reference (optional)</label>
              <input name="reference" type="text" class="input mt-1" placeholder="Transaction reference" value="{{ old('reference') }}">
            </div>
            <div>
              <label class="label">Notes (optional)</label>
              <textarea name="notes" class="input mt-1" rows="2">{{ old('notes') }}</textarea>
            </div>
            <div class="flex gap-2 pt-2">
              <button class="btn-primary" type="submit">Record Payment</button>
              <button type="button" class="btn-ghost" @click="recordModalOpen = false">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Payment Receipt Sidebar -->
    <div class="fixed inset-0 z-40" x-show="receiptOpen" x-transition.opacity style="display:none"
         @keydown.escape.window="receiptOpen = false">
      <div class="absolute inset-0 bg-slate-900/40" @click="receiptOpen = false"></div>
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
              <div class="text-sm font-semibold">Payment Receipt</div>
              <div class="text-xs text-slate-500">Quick preview</div>
            </div>
            <div class="flex items-center gap-2">
              <a :href="receiptSrc.replace('?preview=1', '')" 
                 class="btn-ghost text-xs"
                 target="_blank"
                 x-show="receiptSrc">
                Download PDF
              </a>
              <button class="btn-ghost text-xs" type="button" @click="receiptOpen = false">Close</button>
            </div>
          </div>
          <div class="flex-1 bg-slate-100">
            <iframe :src="receiptSrc" class="w-full h-full border-0"></iframe>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Record Advance Modal (separate Alpine component) -->
  <div
    x-data="{ open: false }"
    x-on:open-advance-modal.window="open = true"
    class="fixed inset-0 z-50"
    x-show="open"
    x-transition.opacity
    style="display:none"
  >
    <div class="absolute inset-0 bg-slate-900/50" @click="open = false"></div>
    <div class="absolute inset-0 flex items-center justify-center p-4">
      <div class="relative w-full max-w-lg bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto"
           @click.stop
           x-transition:enter="transition ease-out duration-200"
           x-transition:enter-start="opacity-0 scale-95"
           x-transition:enter-end="opacity-100 scale-100"
           x-transition:leave="transition ease-in duration-150"
           x-transition:leave-start="opacity-100 scale-100"
           x-transition:leave-end="opacity-0 scale-95">
        <div class="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-900">Record Advance Payment</h3>
          <button type="button" class="p-2 rounded-full hover:bg-slate-100 text-slate-500" @click="open = false">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <form method="POST" action="{{ route('payments.advance.store') }}" class="p-6 space-y-4">
          @csrf
          <div>
            <label class="label">Customer</label>
            <select name="customer_id" class="input mt-1" required>
              <option value="">Select customer...</option>
              @foreach($customers as $customer)
                <option value="{{ $customer->id }}" @selected(old('customer_id')==$customer->id)>
                  {{ $customer->name }}
                </option>
              @endforeach
            </select>
          </div>
          <div>
            <label class="label">Amount (AED)</label>
            <input name="amount" type="number" step="0.01" min="0.01" class="input mt-1" placeholder="0.00" value="{{ old('amount') }}" required>
          </div>
          <div>
            <label class="label">Payment Date</label>
            <input name="payment_date" type="date" class="input mt-1" value="{{ old('payment_date', now()->toDateString()) }}" required>
          </div>
          <div>
            <label class="label">Payment Method (optional)</label>
            <input name="payment_method" type="text" class="input mt-1" placeholder="e.g. Bank Transfer, Cash" value="{{ old('payment_method') }}">
          </div>
          <div>
            <label class="label">Reference (optional)</label>
            <input name="reference" type="text" class="input mt-1" placeholder="Transaction reference" value="{{ old('reference') }}">
          </div>
          <div>
            <label class="label">Notes (optional)</label>
            <textarea name="notes" class="input mt-1" rows="2">{{ old('notes') }}</textarea>
          </div>
          <div class="flex gap-2 pt-2">
            <button class="btn-primary" type="submit">Save Advance</button>
            <button type="button" class="btn-ghost" @click="open = false">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
@endsection
