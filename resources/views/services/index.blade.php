@extends('layouts.app')

@section('title', 'Services')
@section('subtitle', 'Service master with taxable and non-taxable components')

@section('content')
  <div x-data="servicePanel">
    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
      <form method="GET" class="flex flex-col sm:flex-row gap-2 w-full lg:max-w-xl">
        <input class="input" name="search" value="{{ request('search') }}" placeholder="Search services by name or description...">
        <button class="btn-ghost" type="submit">Search</button>
      </form>
      @if(auth()->user()->isAdmin() || auth()->user()->canAccess('services', 'create'))
        <button class="btn-primary" type="button" @click="openCreate()">Add Service</button>
      @endif
    </div>

    <div class="card overflow-hidden">
      <div class="overflow-auto max-h-[680px]">
        <table class="min-w-full">
          <thead>
            <tr>
              <th class="table-th">Service Name</th>
              <th class="table-th">Description</th>
              <th class="table-th">Taxable (AED)</th>
              <th class="table-th">Non‑Taxable (AED)</th>
              <th class="table-th"></th>
            </tr>
          </thead>
          <tbody>
            @forelse($services as $s)
              <tr class="hover:bg-slate-50 transition">
                <td class="table-td font-semibold">{{ $s->name }}</td>
                <td class="table-td text-slate-500">{{ $s->description ?? '—' }}</td>
                <td class="table-td font-semibold">{{ number_format((float) $s->taxable_amount, 2) }}</td>
                <td class="table-td font-semibold">{{ number_format((float) $s->non_taxable_amount, 2) }}</td>
                <td class="table-td text-right">
                  @if(auth()->user()->isAdmin() || auth()->user()->canAccess('services', 'edit'))
                    <button class="btn-ghost text-xs" type="button" @click="openEdit({{ $s->id }}, @js($s))">Edit</button>
                  @endif
                  @if(auth()->user()->isAdmin() || auth()->user()->canAccess('services', 'delete'))
                    <button class="btn-ghost text-xs text-rose-700" type="button" @click="confirmDelete({{ $s->id }})">Delete</button>
                  @endif
                </td>
              </tr>
            @empty
              <tr>
                <td class="table-td text-slate-500" colspan="5">No services found.</td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>
      <div class="px-4 py-3 border-t border-slate-100">
        {{ $services->links() }}
      </div>
    </div>

    <!-- Slide-over panel -->
    <div class="fixed inset-0 z-50" x-show="open" x-transition.opacity style="display:none">
      <div class="absolute inset-0 bg-slate-900/30" @click="close()"></div>
      <div class="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl"
           x-transition:enter="transition duration-200 ease-in-out"
           x-transition:enter-start="translate-x-full"
           x-transition:enter-end="translate-x-0"
           x-transition:leave="transition duration-200 ease-in-out"
           x-transition:leave-start="translate-x-0"
           x-transition:leave-end="translate-x-full"
      >
        <div class="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold" x-text="mode === 'create' ? 'Add Service' : 'Edit Service'"></div>
            <div class="text-xs text-slate-500">VAT applies only on taxable amounts.</div>
          </div>
          <button class="btn-ghost" type="button" @click="close()">Close</button>
        </div>

        <form class="p-5 space-y-4" @submit.prevent="submit()">
          <div>
            <label class="label">Service Name</label>
            <input class="input mt-1" x-model="form.name" required>
          </div>
          <div>
            <label class="label">Description</label>
            <textarea class="input mt-1" x-model="form.description" rows="3"></textarea>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="label">Taxable Amount (AED)</label>
              <input class="input mt-1" x-model.number="form.taxable_amount" type="number" min="0" step="0.01" required>
            </div>
            <div>
              <label class="label">Non‑Taxable Amount (AED)</label>
              <input class="input mt-1" x-model.number="form.non_taxable_amount" type="number" min="0" step="0.01" required>
            </div>
          </div>

          <div class="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div class="text-xs font-semibold text-slate-600">Live cost preview</div>
            <div class="mt-2 text-sm text-slate-700">
              Total (excl. VAT): <span class="font-bold" x-text="(Number(form.taxable_amount||0)+Number(form.non_taxable_amount||0)).toFixed(2)"></span> AED
            </div>
          </div>

          <div class="pt-2 flex items-center justify-end gap-2">
            <button class="btn-ghost" type="button" @click="close()">Cancel</button>
            <button class="btn-primary" type="submit" :disabled="saving">
              <span x-text="saving ? 'Saving...' : 'Save'"></span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <script>
      document.addEventListener('alpine:init', () => {
        Alpine.data('servicePanel', () => ({
          open: false,
          mode: 'create',
          saving: false,
          id: null,
          form: { name: '', description: '', taxable_amount: 0, non_taxable_amount: 0 },

          openCreate() {
            this.mode = 'create';
            this.id = null;
            this.form = { name: '', description: '', taxable_amount: 0, non_taxable_amount: 0 };
            this.open = true;
          },
          openEdit(id, service) {
            this.mode = 'edit';
            this.id = id;
            this.form = {
              name: service.name || '',
              description: service.description || '',
              taxable_amount: Number(service.taxable_amount || 0),
              non_taxable_amount: Number(service.non_taxable_amount || 0),
            };
            this.open = true;
          },
          close() { this.open = false; },

          async submit() {
            this.saving = true;
            try {
              const url = this.mode === 'create'
                ? @js(route('services.store'))
                : @js(url('/services')) + '/' + this.id;

              const res = await fetch(url, {
                method: this.mode === 'create' ? 'POST' : 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                  'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                },
                body: JSON.stringify(this.form),
              });
              if (!res.ok) throw await res.json();
              window.location.reload();
            } catch (e) {
              alert(e?.message || 'Failed to save service.');
            } finally {
              this.saving = false;
            }
          },

          async confirmDelete(id) {
            if (!confirm('Delete this service?')) return;
            try {
              const res = await fetch(@js(url('/services')) + '/' + id, {
                method: 'DELETE',
                headers: {
                  'Accept': 'application/json',
                  'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                },
              });
              if (!res.ok) throw await res.json();
              window.location.reload();
            } catch (e) {
              alert(e?.message || 'Failed to delete service.');
            }
          }
        }))
      })
    </script>
  </div>
@endsection

