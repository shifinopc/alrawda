@extends('layouts.app')

@section('title', 'Settings')
@section('subtitle', 'Invoice header/footer branding')

@section('content')
  <div class="space-y-4">
    @include('settings._nav')

    <div class="card p-5" x-data="{ dragging: false }">
      <div class="text-sm font-semibold">Invoice Template</div>
      <div class="text-xs text-slate-500">Upload header and footer images for PDF invoices.</div>

      <form method="POST" action="{{ route('settings.invoice_template.update') }}" enctype="multipart/form-data" class="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        @csrf

        <div class="rounded-xl border-2 border-dashed border-slate-200 bg-white p-5"
             @dragenter.prevent="dragging=true"
             @dragleave.prevent="dragging=false"
             @dragover.prevent
             @drop.prevent="dragging=false"
             :class="dragging ? 'border-brand-300 bg-brand-50/40' : ''"
        >
          <div class="text-sm font-semibold">Header Image</div>
          <div class="text-xs text-slate-500 mt-1">Recommended: 2480×350 (A4 width), PNG/JPG.</div>
          <input class="input mt-3" type="file" name="header_image" accept="image/*">
          @if($template?->header_image_path)
            <div class="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div class="text-xs font-semibold text-slate-600">Current Header</div>
              <img class="mt-2 w-full rounded-lg border border-slate-100" src="{{ asset('storage/'.$template->header_image_path) }}" alt="Header preview">
            </div>
          @endif
        </div>

        <div class="rounded-xl border-2 border-dashed border-slate-200 bg-white p-5"
             @dragenter.prevent="dragging=true"
             @dragleave.prevent="dragging=false"
             @dragover.prevent
             @drop.prevent="dragging=false"
             :class="dragging ? 'border-brand-300 bg-brand-50/40' : ''"
        >
          <div class="text-sm font-semibold">Footer Image</div>
          <div class="text-xs text-slate-500 mt-1">Recommended: 2480×250, PNG/JPG.</div>
          <input class="input mt-3" type="file" name="footer_image" accept="image/*">
          @if($template?->footer_image_path)
            <div class="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div class="text-xs font-semibold text-slate-600">Current Footer</div>
              <img class="mt-2 w-full rounded-lg border border-slate-100" src="{{ asset('storage/'.$template->footer_image_path) }}" alt="Footer preview">
            </div>
          @endif
        </div>

        <div class="lg:col-span-2 flex items-center justify-between">
          <div class="text-xs text-slate-500">Tip: run `php artisan storage:link` once to show previews.</div>
          <button class="btn-primary" type="submit">Save</button>
        </div>
      </form>

      <div class="mt-5 rounded-lg bg-slate-50 border border-slate-100 p-4">
        <div class="text-sm font-semibold">Live Preview</div>
        <div class="text-xs text-slate-500 mt-1">Open any invoice and click “Download PDF”.</div>
      </div>
    </div>
  </div>
@endsection

