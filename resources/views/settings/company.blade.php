@extends('layouts.app')

@section('title', 'Settings')
@section('subtitle', 'Company profile and invoicing identity')

@section('content')
  <div class="space-y-4">
    @include('settings._nav')

    <div class="card p-5">
      <div class="text-sm font-semibold">Company Profile</div>
      <div class="text-xs text-slate-500">Shown on PDF invoices (supplier details) and in the app sidebar.</div>

      <form method="POST"
            action="{{ route('settings.company.update') }}"
            enctype="multipart/form-data"
            class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        @csrf
        <div>
          <label class="label">Company Name</label>
          <input class="input mt-1" name="company_name" value="{{ old('company_name', $company->company_name) }}" required>
        </div>
        <div>
          <label class="label">TRN Number</label>
          <input class="input mt-1" name="trn_number" value="{{ old('trn_number', $company->trn_number) }}" placeholder="Tax Registration Number">
        </div>
        <div class="space-y-2">
          <label class="label">Company Logo</label>
          <div class="flex items-center gap-4">
            <div class="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center overflow-hidden">
              @if($company->logo_path)
                <img src="{{ asset('storage/'.$company->logo_path) }}" alt="Company logo" class="h-12 w-12 object-contain">
              @else
                <span class="text-xs font-semibold text-slate-400">
                  {{ strtoupper(mb_substr($company->company_name ?? 'A', 0, 1)) }}
                </span>
              @endif
            </div>
            <div class="flex-1">
              <input class="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
                     type="file"
                     name="logo"
                     accept="image/png,image/jpeg,image/webp">
              <p class="mt-1 text-[11px] text-slate-400">
                PNG/JPG/WebP, up to 1 MB. Shown in the sidebar and invoices.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label class="label">Email</label>
          <input class="input mt-1" name="email" type="email" value="{{ old('email', $company->email) }}">
        </div>
        <div>
          <label class="label">Phone</label>
          <input class="input mt-1" name="phone" value="{{ old('phone', $company->phone) }}">
        </div>
        <div>
          <label class="label">Revenue Target (AED) – Optional</label>
          <input class="input mt-1" name="revenue_target" type="number" step="0.01" min="0" value="{{ old('revenue_target', $company->revenue_target) }}" placeholder="e.g. 50000">
          <p class="mt-1 text-[11px] text-slate-400">Used for the dashboard target vs actual progress bar.</p>
        </div>
        <div class="md:col-span-2">
          <label class="label">Address</label>
          <textarea class="input mt-1" name="address" rows="3">{{ old('address', $company->address) }}</textarea>
        </div>

        <div class="md:col-span-2 flex justify-end">
          <button class="btn-primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  </div>
@endsection

