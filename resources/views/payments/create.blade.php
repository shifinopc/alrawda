@extends('layouts.app')

@section('title', 'Record Payment')
@section('subtitle', 'Add a new payment against an invoice')

@section('content')
  <div class="card p-5 max-w-xl space-y-8">
    <form method="POST" action="{{ route('payments.store') }}" class="space-y-4" x-data="{ submitting:false }" x-on:submit="submitting = true">
      @csrf
      <div>
        <label class="label">Invoice</label>
        <select name="invoice_id" class="input mt-1 @error('invoice_id') border-rose-300 ring-1 ring-rose-200 @enderror" required>
          <option value="">Select invoice...</option>
          @foreach($invoices as $inv)
            @php $outstanding = (float) $inv->grand_total - $inv->payments->sum('amount'); @endphp
            <option value="{{ $inv->id }}">
              {{ $inv->invoice_number }} – {{ $inv->customer->name }} (Outstanding: {{ number_format($outstanding, 2) }} AED)
            </option>
          @endforeach
        </select>
        @if($invoices->isEmpty())
          <p class="text-sm text-slate-500 mt-1">No invoices with outstanding balance.</p>
        @endif
        @error('invoice_id')
          <p class="mt-1 text-xs text-rose-600">{{ $message }}</p>
        @enderror
      </div>
      <div>
        <label class="label">Amount (AED)</label>
        <input name="amount" type="number" step="0.01" min="0.01" class="input mt-1 @error('amount') border-rose-300 ring-1 ring-rose-200 @enderror" placeholder="0.00" required>
        @error('amount')
          <p class="mt-1 text-xs text-rose-600">{{ $message }}</p>
        @enderror
      </div>
      <div>
        <label class="label">Payment Date</label>
        <input name="payment_date" type="date" class="input mt-1 @error('payment_date') border-rose-300 ring-1 ring-rose-200 @enderror" value="{{ now()->toDateString() }}" required>
        @error('payment_date')
          <p class="mt-1 text-xs text-rose-600">{{ $message }}</p>
        @enderror
      </div>
      <div>
        <label class="label">Payment Method (optional)</label>
        <input name="payment_method" type="text" class="input mt-1" placeholder="e.g. Bank Transfer, Cash">
      </div>
      <div>
        <label class="label">Reference (optional)</label>
        <input name="reference" type="text" class="input mt-1" placeholder="Transaction reference">
      </div>
      <div>
        <label class="label">Notes (optional)</label>
        <textarea name="notes" class="input mt-1" rows="2"></textarea>
      </div>
      <div class="flex gap-2">
        <button class="btn-primary flex items-center gap-2" type="submit" x-bind:disabled="submitting">
          <svg x-show="submitting" class="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          <span x-text="submitting ? 'Recording...' : 'Record Payment'"></span>
        </button>
        <a class="btn-ghost" href="{{ route('payments.index') }}">Cancel</a>
      </div>
    </form>

    <hr class="border-slate-200">

    <div>
      <h2 class="text-sm font-semibold mb-3">Record Advance Payment</h2>
      <form method="POST" action="{{ route('payments.advance.store') }}" class="space-y-4" x-data="{ submitting:false }" x-on:submit="submitting = true">
        @csrf
        <div>
          <label class="label">Customer</label>
          <select name="customer_id" class="input mt-1 @error('customer_id') border-rose-300 ring-1 ring-rose-200 @enderror" required>
            <option value="">Select customer...</option>
            @foreach($customers as $customer)
              <option value="{{ $customer->id }}">{{ $customer->name }}</option>
            @endforeach
          </select>
        </div>
        <div>
          <label class="label">Amount (AED)</label>
          <input name="amount" type="number" step="0.01" min="0.01" class="input mt-1" placeholder="0.00" required>
        </div>
        <div>
          <label class="label">Payment Date</label>
          <input name="payment_date" type="date" class="input mt-1" value="{{ now()->toDateString() }}" required>
        </div>
        <div>
          <label class="label">Payment Method (optional)</label>
          <input name="payment_method" type="text" class="input mt-1" placeholder="e.g. Bank Transfer, Cash">
        </div>
        <div>
          <label class="label">Reference (optional)</label>
          <input name="reference" type="text" class="input mt-1" placeholder="Transaction reference">
        </div>
        <div>
          <label class="label">Notes (optional)</label>
          <textarea name="notes" class="input mt-1" rows="2"></textarea>
        </div>
        <div class="flex gap-2">
          <button class="btn-ghost flex items-center gap-2" type="submit" x-bind:disabled="submitting">
            <svg x-show="submitting" class="h-4 w-4 animate-spin text-slate-700" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <span x-text="submitting ? 'Recording...' : 'Record Advance'"></span>
          </button>
        </div>
      </form>
    </div>
  </div>
@endsection
