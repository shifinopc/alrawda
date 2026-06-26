@extends('layouts.app')

@section('title', 'Create Invoice')
@section('subtitle', 'Select customer, add services or packages, review VAT and totals')

@section('content')
  @php
    $vatEnabled = $taxSetting?->vat_enabled ?? true;
    $vatPercentage = (float) ($taxSetting?->vat_percentage ?? 5);
    $vatRate = $vatEnabled ? $vatPercentage / 100 : 0;
    $servicesJson = $services->map(fn ($s) => ['id' => $s->id, 'name' => $s->name, 'taxable' => (float) $s->taxable_amount, 'non_taxable' => (float) $s->non_taxable_amount])->values()->toJson();
    $packagesJson = isset($packages) ? $packages->values()->toJson() : '[]';
  @endphp

  <form method="POST" action="{{ route('invoices.store') }}"
        x-data='invoiceBuilder({{ $vatRate }}, {!! $servicesJson !!}, {!! $packagesJson !!}, null, 0, 0)'
        x-on:submit="submitting = true"
        class="grid grid-cols-1 xl:grid-cols-3 gap-4"
  >
    @csrf

    <div class="xl:col-span-2 space-y-4">
      <div class="card p-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="label">Customer</label>
            <select name="customer_id" class="input mt-1 @error('customer_id') border-rose-300 ring-1 ring-rose-200 @enderror" required>
              <option value="">Select customer...</option>
              @foreach($customers as $c)
                <option value="{{ $c->id }}" @selected(old('customer_id')==$c->id)>{{ $c->name }}</option>
              @endforeach
            </select>
            @error('customer_id')
              <p class="mt-1 text-xs text-rose-600">{{ $message }}</p>
            @enderror
          </div>
          <div>
            <label class="label">Invoice Date</label>
            <input name="invoice_date" type="date" class="input mt-1 @error('invoice_date') border-rose-300 ring-1 ring-rose-200 @enderror" value="{{ old('invoice_date', now()->toDateString()) }}" required>
            @error('invoice_date')
              <p class="mt-1 text-xs text-rose-600">{{ $message }}</p>
            @enderror
          </div>
          <div x-data="{ setDue(val) { $refs.dueInput.value = val; } }">
            <label class="label">Due Date (optional)</label>
            <input name="due_date" type="date" class="input mt-1 @error('due_date') border-rose-300 ring-1 ring-rose-200 @enderror" value="{{ old('due_date') }}" x-ref="dueInput">
            <div class="mt-1 flex gap-2">
              <button type="button" class="text-xs text-brand-600 hover:underline" @click="setDue('{{ now()->addDays(7)->toDateString() }}')">Net 7</button>
              <button type="button" class="text-xs text-brand-600 hover:underline" @click="setDue('{{ now()->addDays(15)->toDateString() }}')">Net 15</button>
              <button type="button" class="text-xs text-brand-600 hover:underline" @click="setDue('{{ now()->addDays(30)->toDateString() }}')">Net 30</button>
            </div>
            @error('due_date')
              <p class="mt-1 text-xs text-rose-600">{{ $message }}</p>
            @enderror
          </div>
        </div>
        <div class="mt-4">
          <label class="label">Notes (optional)</label>
          <textarea name="notes" class="input mt-1" rows="3">{{ old('notes') }}</textarea>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold">Services &amp; Packages</div>
            <div class="text-xs text-slate-500">Add services or packages, set quantities.</div>
          </div>
          <button class="btn-ghost" type="button" @click="addItem()">+ Add row</button>
        </div>

        <div class="overflow-auto max-h-[520px]">
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="table-th">Service or Package</th>
                <th class="table-th">Qty</th>
                <th class="table-th">Non‑Taxable</th>
                <th class="table-th">Taxable</th>
                <th class="table-th">VAT</th>
                <th class="table-th">Line Total</th>
                <th class="table-th"></th>
              </tr>
            </thead>
            <tbody>
              <template x-for="(row, idx) in items" :key="row.key">
                <tr class="hover:bg-slate-50 transition"
                    x-transition:enter="transition duration-200 ease-out"
                    x-transition:enter-start="opacity-0 -translate-y-1"
                    x-transition:enter-end="opacity-100 translate-y-0"
                >
                  <td class="table-td min-w-[280px]">
                    <input type="hidden" :name="'items['+idx+'][service_id]'" :value="row.service_id || ''">
                    <input type="hidden" :name="'items['+idx+'][package_id]'" :value="row.package_id || ''">
                    <select class="input" x-model="row.selected"
                            x-effect="if (row.selected) { row.service_id = row.selected.startsWith('s-') ? row.selected.slice(2) : ''; row.package_id = row.selected.startsWith('p-') ? row.selected.slice(2) : ''; }"
                            required>
                      <option value="">Select service or package...</option>
                      <optgroup label="Services">
                        <template x-for="s in services" :key="'s-'+s.id">
                          <option :value="'s-'+s.id" x-text="s.name"></option>
                        </template>
                      </optgroup>
                      <optgroup label="Packages" x-show="packages && packages.length">
                        <template x-for="p in packages" :key="'p-'+p.id">
                          <option :value="'p-'+p.id" x-text="p.name"></option>
                        </template>
                      </optgroup>
                    </select>
                  </td>
                  <td class="table-td w-[110px]">
                    <input class="input" type="number" min="1" step="1"
                           x-model.number="row.quantity" :name="'items['+idx+'][quantity]'" required>
                  </td>
                  <td class="table-td">
                    <span class="font-semibold" x-text="money(lineNonTaxable(row))"></span>
                  </td>
                  <td class="table-td">
                    <span class="font-semibold" x-text="money(lineTaxable(row))"></span>
                  </td>
                  <td class="table-td">
                    <span class="font-semibold" x-text="money(lineVat(row))"></span>
                  </td>
                  <td class="table-td">
                    <span class="font-semibold" x-text="money(lineTotal(row))"></span>
                  </td>
                  <td class="table-td text-right">
                    <button class="btn-ghost text-xs" type="button" @click="removeItem(idx)" x-show="items.length > 1">Remove</button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="space-y-4">
      <div class="card p-5 sticky top-24">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-semibold">Totals</div>
            <div class="text-xs text-slate-500">
              VAT: {{ $vatEnabled ? number_format($vatPercentage, 2) : 'Disabled' }}{{ $vatEnabled ? '%' : '' }}
            </div>
          </div>
        </div>

        <div class="mt-4 space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-slate-600">Subtotal Taxable</span>
            <span class="font-semibold" x-text="money(subtotalTaxable())"></span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-600">Subtotal Non‑Taxable</span>
            <span class="font-semibold" x-text="money(subtotalNonTaxable())"></span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-600">VAT Amount</span>
            <span class="font-semibold" x-text="money(vatTotal())"></span>
          </div>
          <div class="pt-2 mt-2 border-t border-slate-100 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-slate-600">Discount (AED)</span>
              <input type="number" step="0.01" min="0" class="input w-24 text-right" name="discount_amount" x-model.number="discountAmount" placeholder="0">
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-slate-600">Rounding</span>
              <div class="flex items-center gap-2 flex-wrap">
                <select class="input flex-1 min-w-[100px]" x-model="roundingType" @change="roundingType === 'none' && (roundingValue = 0)">
                  <option value="none">None</option>
                  <option value="add">Add to total</option>
                  <option value="reduce">Reduce from total</option>
                </select>
                <input type="number" step="0.01" min="0" class="input w-20 text-right" x-model.number="roundingValue" placeholder="0" x-show="roundingType !== 'none'">
              </div>
              <input type="hidden" name="rounding_adjustment" :value="roundingAdjustmentValue()">
            </div>
          </div>
          <div class="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
            <span class="text-slate-900 font-semibold">Grand Total</span>
            <span class="text-slate-900 font-bold text-lg" x-text="money(grandTotal())"></span>
          </div>
        </div>

        <button class="btn-primary w-full mt-5 flex items-center justify-center gap-2" type="submit"
                x-bind:disabled="submitting">
          <svg x-show="submitting" class="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          <span x-text="submitting ? 'Saving...' : 'Save Invoice'"></span>
        </button>
        <a class="btn-ghost w-full mt-2 text-center" href="{{ route('invoices.index') }}">Back</a>
      </div>
    </div>
  </form>

  <script>
    function invoiceBuilder(vatRate, services, packages, initialItems = null, initialDiscount = 0, initialRounding = 0) {
      services = services || [];
      packages = packages || [];
      const defaultRow = () => ({ key: Date.now() + Math.random(), selected: '', service_id: '', package_id: '', quantity: 1 });
      const items = initialItems && initialItems.length ? initialItems.map(r => ({ ...defaultRow(), ...r, key: r.key || Date.now() + Math.random() })) : [defaultRow()];
      const roundingTypeFromValue = (v) => (v > 0 ? 'add' : v < 0 ? 'reduce' : 'none');
      const roundingValueFromValue = (v) => (v !== 0 ? Math.abs(Number(v)) : 0);
      return {
        vatRate,
        services,
        packages,
        items,
        submitting: false,
        discountAmount: Number(initialDiscount) || 0,
        roundingType: roundingTypeFromValue(initialRounding),
        roundingValue: roundingValueFromValue(initialRounding),
        addItem() { this.items.push(defaultRow()); },
        removeItem(idx) { this.items.splice(idx, 1); },
        serviceById(id) { return this.services.find(s => Number(s.id) === Number(id)); },
        packageById(id) { return this.packages.find(p => Number(p.id) === Number(id)); },
        lineTaxable(row) {
          const qty = Number(row.quantity || 0);
          if (row.selected && row.selected.startsWith('p-')) {
            const p = this.packageById(row.selected.slice(2)); return p ? Number(p.taxable) * qty : 0;
          }
          const s = this.serviceById(row.service_id); return s ? Number(s.taxable) * qty : 0;
        },
        lineNonTaxable(row) {
          const qty = Number(row.quantity || 0);
          if (row.selected && row.selected.startsWith('p-')) {
            const p = this.packageById(row.selected.slice(2)); return p ? Number(p.non_taxable) * qty : 0;
          }
          const s = this.serviceById(row.service_id); return s ? Number(s.non_taxable) * qty : 0;
        },
        lineVat(row) { return this.lineTaxable(row) * Number(this.vatRate || 0); },
        lineTotal(row) { return this.lineTaxable(row) + this.lineNonTaxable(row) + this.lineVat(row); },
        subtotalTaxable() { return this.items.reduce((sum, r) => sum + this.lineTaxable(r), 0); },
        subtotalNonTaxable() { return this.items.reduce((sum, r) => sum + this.lineNonTaxable(r), 0); },
        vatTotal() { return this.items.reduce((sum, r) => sum + this.lineVat(r), 0); },
        roundingAdjustmentValue() {
          if (this.roundingType === 'add') return Number(this.roundingValue) || 0;
          if (this.roundingType === 'reduce') return -(Number(this.roundingValue) || 0);
          return 0;
        },
        grandTotal() {
          const base = this.subtotalTaxable() + this.subtotalNonTaxable() + this.vatTotal();
          const discount = Math.max(0, Number(this.discountAmount) || 0);
          const rounding = this.roundingAdjustmentValue();
          return Math.max(0, base - discount + rounding);
        },
        money(v) {
          const n = Math.round(Number(v || 0) * 100) / 100;
          return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' AED';
        },
      }
    }
  </script>
@endsection

