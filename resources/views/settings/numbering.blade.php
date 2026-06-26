@extends('layouts.app')

@section('title', 'Settings')
@section('subtitle', 'Invoice and payment numbering')

@section('content')
  <div class="space-y-4">
    @include('settings._nav')

    <form method="POST" action="{{ route('settings.numbering.update') }}" class="space-y-6">
      @csrf

      <div class="card p-5">
        <div class="text-sm font-semibold">Invoice Numbering</div>
        <div class="text-xs text-slate-500">Controls how invoice numbers are generated (e.g. INV-00001).</div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="label">Prefix</label>
            <input class="input mt-1" name="invoice_prefix" value="{{ old('invoice_prefix', $invoiceNumbering->prefix) }}" required>
          </div>
          <div>
            <label class="label">Next Number</label>
            <input class="input mt-1" name="invoice_next_number" type="number" min="1" step="1" value="{{ old('invoice_next_number', $invoiceNumbering->next_number) }}" required>
          </div>
          <div>
            <label class="label">Padding</label>
            <input class="input mt-1" name="invoice_padding" type="number" min="1" max="10" step="1" value="{{ old('invoice_padding', $invoiceNumbering->padding) }}" required>
          </div>
        </div>
        <div class="mt-3 text-xs text-slate-500">
          Preview: <span class="font-semibold text-slate-700">{{ $invoiceNumbering->prefix }}-{{ str_pad((string) $invoiceNumbering->next_number, (int) $invoiceNumbering->padding, '0', STR_PAD_LEFT) }}</span>
        </div>
      </div>

      <div class="card p-5">
        <div class="text-sm font-semibold">Payment Numbering</div>
        <div class="text-xs text-slate-500">Controls how payment/receipt numbers are generated (e.g. PAY-00001).</div>
        <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="label">Prefix</label>
            <input class="input mt-1" name="payment_prefix" value="{{ old('payment_prefix', $paymentNumbering->prefix) }}" required>
          </div>
          <div>
            <label class="label">Next Number</label>
            <input class="input mt-1" name="payment_next_number" type="number" min="1" step="1" value="{{ old('payment_next_number', $paymentNumbering->next_number) }}" required>
          </div>
          <div>
            <label class="label">Padding</label>
            <input class="input mt-1" name="payment_padding" type="number" min="1" max="10" step="1" value="{{ old('payment_padding', $paymentNumbering->padding) }}" required>
          </div>
        </div>
        <div class="mt-3 text-xs text-slate-500">
          Preview: <span class="font-semibold text-slate-700">{{ $paymentNumbering->prefix }}-{{ str_pad((string) $paymentNumbering->next_number, (int) $paymentNumbering->padding, '0', STR_PAD_LEFT) }}</span>
        </div>
      </div>

      <div class="flex gap-2">
        <button class="btn-primary" type="submit">Save numbering</button>
        <a class="btn-ghost" href="{{ route('settings.company') }}">Cancel</a>
      </div>
    </form>
  </div>
@endsection
