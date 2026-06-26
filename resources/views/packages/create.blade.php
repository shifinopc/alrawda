@extends('layouts.app')

@section('title', 'Add Package')
@section('subtitle', 'Add services to build a package; optional discount and rounding')

@section('content')
  @php
    $servicesJson = $services->map(fn ($s) => [
      'id' => $s->id,
      'name' => $s->name,
      'taxable_amount' => (float) $s->taxable_amount,
      'non_taxable_amount' => (float) $s->non_taxable_amount,
    ])->values()->toJson();
  @endphp
  <div x-data='packageForm({!! $servicesJson !!}, null)'>
    <form action="{{ route('packages.store') }}" method="POST">
      @csrf

      <div class="card p-5 space-y-5">
        <div>
          <label class="label">Package Name</label>
          <input class="input mt-1 w-full" type="text" name="name" value="{{ old('name') }}" required placeholder="e.g. Weekend Bundle">
        </div>
        <div>
          <label class="label">Description</label>
          <textarea class="input mt-1 w-full" name="description" rows="2" placeholder="Optional">{{ old('description') }}</textarea>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div class="space-y-3">
            <div class="font-semibold text-slate-700">Discount (optional)</div>
            <div class="flex flex-wrap gap-3 items-center">
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="discount_type" value="" x-model="discountType" checked> None
              </label>
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="discount_type" value="percentage" x-model="discountType"> Percentage
              </label>
              <label class="inline-flex items-center gap-2">
                <input type="radio" name="discount_type" value="fixed" x-model="discountType"> Fixed (AED)
              </label>
            </div>
            <div x-show="discountType" class="flex items-center gap-2">
              <input type="number" name="discount_value" step="0.01" min="0" class="input w-32" placeholder="Value"
                     x-model.number="discountValue">
              <span x-text="discountType === 'percentage' ? '%' : 'AED'"></span>
            </div>
            <p x-show="discountType" class="text-xs text-slate-500 mt-1">Discount is applied to taxable amount only; VAT will be calculated on the reduced taxable.</p>
          </div>
          <div class="space-y-3">
            <div class="font-semibold text-slate-700">Rounding (optional)</div>
            <select name="rounding_rule" class="input w-full" x-model="roundingRule">
              <option value="">None</option>
              <option value="nearest_5">Nearest 5</option>
              <option value="nearest_10">Nearest 10</option>
              <option value="nearest_50">Nearest 50</option>
              <option value="custom">Custom target (e.g. 670)</option>
            </select>
            <div x-show="roundingRule === 'custom'" class="mt-2">
              <input type="number" name="rounding_target" step="0.01" min="0" class="input w-32" placeholder="e.g. 670" x-model.number="roundingTarget">
            </div>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="font-semibold text-slate-700">Services in package</span>
            <button type="button" class="btn-ghost text-sm" @click="addItem()">+ Add service</button>
          </div>
          <div class="border border-slate-200 rounded-lg overflow-hidden">
            <table class="min-w-full text-sm">
              <thead class="bg-slate-50">
                <tr>
                  <th class="table-th text-left">Service</th>
                  <th class="table-th text-left w-24">Qty</th>
                  <th class="table-th text-left w-28">Taxable (override)</th>
                  <th class="table-th text-left w-28">Non‑taxable (override)</th>
                  <th class="table-th w-16"></th>
                </tr>
              </thead>
              <tbody>
                <template x-for="(row, i) in items" :key="i">
                  <tr class="border-t border-slate-100">
                    <td class="p-2">
                      <select :name="'items[' + i + '][service_id]'" class="input text-sm w-full" required
                              x-model="row.service_id"
                              @change="onServiceChange(i, $event.target.value)">
                        <option value="">Select service</option>
                        <template x-for="s in services" :key="s.id">
                          <option :value="s.id" x-text="s.name"></option>
                        </template>
                      </select>
                    </td>
                    <td class="p-2">
                      <input type="number" :name="'items[' + i + '][quantity]'" min="1" class="input text-sm w-full" x-model.number="row.quantity" required>
                    </td>
                    <td class="p-2">
                      <input type="number" step="0.01" min="0" :name="'items[' + i + '][taxable_amount]'" class="input text-sm w-full" placeholder="From service"
                             x-model="row.taxable_amount">
                    </td>
                    <td class="p-2">
                      <input type="number" step="0.01" min="0" :name="'items[' + i + '][non_taxable_amount]'" class="input text-sm w-full" placeholder="From service"
                             x-model="row.non_taxable_amount">
                    </td>
                    <td class="p-2">
                      <button type="button" class="text-rose-600 hover:text-rose-800" @click="removeItem(i)">Remove</button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
            <template x-if="items.length === 0">
              <div class="p-4 text-slate-500 text-sm text-center">Click “Add service” to add services to this package.</div>
            </template>
          </div>
          <p class="text-xs text-slate-500 mt-1">Leave taxable/non‑taxable blank to use the service’s default amounts.</p>
        </div>

        <div class="rounded-lg bg-slate-50 border border-slate-100 p-4">
          <div class="text-sm font-semibold text-slate-700">Preview (computed from services)</div>
          <div class="mt-2 text-sm text-slate-600 space-y-1">
            <div>Raw total (excl. VAT): <span class="font-bold" x-text="rawTotal().toFixed(2)"></span> AED <span class="text-slate-500">(taxable: <span x-text="rawTaxable().toFixed(2)"></span> + non‑taxable: <span x-text="rawNonTaxable().toFixed(2)"></span>)</span></div>
            <div x-show="discountType">After discount (taxable reduced): <span class="font-bold" x-text="afterDiscountTotal().toFixed(2)"></span> AED <span class="text-slate-500">(taxable: <span x-text="afterDiscountTaxable().toFixed(2)"></span>, non‑taxable unchanged)</span></div>
            <div x-show="roundingRule">After rounding: <span class="font-bold" x-text="afterRoundingTotal().toFixed(2)"></span> AED</div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <a href="{{ route('packages.index') }}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Create Package</button>
        </div>
      </div>
    </form>
  </div>

  <script>
    document.addEventListener('alpine:init', () => {
      Alpine.data('packageForm', (servicesList, initialItems) => ({
        services: servicesList || [],
        items: (Array.isArray(initialItems) && initialItems.length) ? initialItems : [{ service_id: '', quantity: 1, taxable_amount: '', non_taxable_amount: '' }],
        discountType: '{{ old('discount_type', '') }}',
        discountValue: {{ old('discount_value', 0) }},
        roundingRule: '{{ old('rounding_rule', '') }}',
        roundingTarget: {{ old('rounding_target', 0) }},

        addItem() {
          this.items.push({ service_id: '', quantity: 1, taxable_amount: '', non_taxable_amount: '' });
        },
        removeItem(i) {
          this.items.splice(i, 1);
          if (this.items.length === 0) this.items.push({ service_id: '', quantity: 1, taxable_amount: '', non_taxable_amount: '' });
        },
        onServiceChange(i, serviceId) {
          const s = this.services.find(x => x.id == serviceId);
          if (s) {
            this.items[i].taxable_amount = this.items[i].taxable_amount || s.taxable_amount;
            this.items[i].non_taxable_amount = this.items[i].non_taxable_amount || s.non_taxable_amount;
          }
        },
        lineTaxable(row) {
          const s = this.services.find(x => x.id == row.service_id);
          const tax = s ? (row.taxable_amount !== '' && row.taxable_amount !== null ? parseFloat(row.taxable_amount) : s.taxable_amount) : 0;
          return tax * (row.quantity || 0);
        },
        lineNonTaxable(row) {
          const s = this.services.find(x => x.id == row.service_id);
          const non = s ? (row.non_taxable_amount !== '' && row.non_taxable_amount !== null ? parseFloat(row.non_taxable_amount) : s.non_taxable_amount) : 0;
          return non * (row.quantity || 0);
        },
        rawTaxable() {
          return this.items.reduce((sum, row) => sum + this.lineTaxable(row), 0);
        },
        rawNonTaxable() {
          return this.items.reduce((sum, row) => sum + this.lineNonTaxable(row), 0);
        },
        rawTotal() {
          return this.rawTaxable() + this.rawNonTaxable();
        },
        // Discount applied to taxable amount only; non-taxable unchanged so VAT is on reduced taxable
        afterDiscountTaxable() {
          const rawT = this.rawTaxable();
          const val = Number(this.discountValue) || 0;
          if (this.discountType === 'percentage') return Math.max(0, rawT * (1 - val / 100));
          if (this.discountType === 'fixed') return Math.max(0, rawT - val);
          return rawT;
        },
        afterDiscountTotal() {
          return this.afterDiscountTaxable() + this.rawNonTaxable();
        },
        afterRoundingTotal() {
          let t = this.afterDiscountTotal();
          if (this.roundingRule === 'nearest_5') t = Math.round(t / 5) * 5;
          else if (this.roundingRule === 'nearest_10') t = Math.round(t / 10) * 10;
          else if (this.roundingRule === 'nearest_50') t = Math.round(t / 50) * 50;
          else if (this.roundingRule === 'custom') {
            const target = Number(this.roundingTarget);
            if (!isNaN(target)) t = target;
          }
          return t;
        }
      }));
    });
  </script>
@endsection
