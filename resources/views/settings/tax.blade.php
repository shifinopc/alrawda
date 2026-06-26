@extends('layouts.app')

@section('title', 'Settings')
@section('subtitle', 'VAT configuration and tax rules')

@section('content')
  <div class="space-y-4">
    @include('settings._nav')

    <div class="card p-5">
      <div class="text-sm font-semibold">Tax Settings</div>
      <div class="text-xs text-slate-500">VAT applies only on taxable amounts.</div>

      <form method="POST" action="{{ route('settings.tax.update') }}" class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        @csrf
        <div>
          <label class="label">VAT Percentage</label>
          <input class="input mt-1" name="vat_percentage" type="number" min="0" max="100" step="0.01"
                 value="{{ old('vat_percentage', (float) $tax->vat_percentage) }}" required>
        </div>
        <div class="flex items-center gap-3 mt-6">
          <input id="vat_enabled" type="checkbox" name="vat_enabled" value="1" class="rounded border-slate-300"
                 @checked(old('vat_enabled', $tax->vat_enabled))>
          <label for="vat_enabled" class="text-sm font-semibold text-slate-700">Enable VAT</label>
        </div>
        <div class="md:col-span-2 flex justify-end">
          <button class="btn-primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  </div>
@endsection

