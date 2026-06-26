@extends('layouts.app')

@section('title', 'Customers')
@section('subtitle', 'Manage customers and TRN details')

@section('content')
  <div x-data="customerPanel">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
      <form method="GET" class="flex gap-2 w-full md:max-w-md">
        <input class="input" name="search" value="{{ request('search') }}" placeholder="Search customers...">
        <button class="btn-ghost" type="submit">Search</button>
      </form>
      @if(auth()->user()->isAdmin() || auth()->user()->canAccess('customers', 'create'))
        <button class="btn-primary" type="button" @click="openCreate()">
          Add Customer
        </button>
      @endif
    </div>

    <div class="card overflow-hidden">
    <div class="overflow-auto max-h-[620px]">
      <table class="min-w-full">
        <thead>
          <tr>
            <th class="table-th">Name</th>
            <th class="table-th">Customer Ref</th>
            <th class="table-th">TRN</th>
            <th class="table-th">Mobile No</th>
            <th class="table-th">Alternate No</th>
            <th class="table-th"></th>
          </tr>
        </thead>
        <tbody>
          @forelse($customers as $c)
            <tr class="hover:bg-slate-50 transition">
              <td class="table-td font-semibold">{{ $c->name }}</td>
              <td class="table-td">{{ $c->customer_ref ?? '—' }}</td>
              <td class="table-td">{{ $c->trn_number ?? '—' }}</td>
              <td class="table-td">{{ $c->phone ?? '—' }}</td>
              <td class="table-td">{{ $c->alternate_number ?? '—' }}</td>
              <td class="table-td text-right">
                @if(auth()->user()->isAdmin() || auth()->user()->canAccess('customers', 'edit'))
                  <button class="btn-ghost text-xs" type="button"
                          @click="openEdit({{ $c->id }}, @js($c))">Edit</button>
                @endif
                @if(auth()->user()->isAdmin() || auth()->user()->canAccess('customers', 'delete'))
                  <button class="btn-ghost text-xs text-rose-700" type="button"
                          @click="confirmDelete({{ $c->id }})">Delete</button>
                @endif
              </td>
            </tr>
            @empty
            <tr><td class="table-td text-slate-500" colspan="6">No customers found.</td></tr>
          @endforelse
        </tbody>
      </table>
    </div>

    <div class="px-4 py-3 border-t border-slate-100">
      {{ $customers->links() }}
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
            <div class="text-sm font-semibold" x-text="mode === 'create' ? 'Add Customer' : 'Edit Customer'"></div>
            <div class="text-xs text-slate-500">Saved customers are reusable for invoices.</div>
          </div>
          <button class="btn-ghost" type="button" @click="close()">Close</button>
        </div>

        <form class="p-5 space-y-4" @submit.prevent="submit()">
          <div>
            <label class="label">Customer Name</label>
            <input class="input mt-1" x-model="form.name" required>
          </div>
          <div>
            <label class="label">Customer Ref</label>
            <input class="input mt-1" x-model="form.customer_ref" placeholder="e.g. AU04270">
          </div>
          <div>
            <label class="label">TRN Number</label>
            <input class="input mt-1" x-model="form.trn_number" placeholder="Tax Registration Number">
          </div>
          <div>
            <label class="label">Mobile No</label>
            <input class="input mt-1" x-model="form.phone" placeholder="e.g. +971529683993">
          </div>
          <div>
            <label class="label">Alternate Number</label>
            <input class="input mt-1" x-model="form.alternate_number" placeholder="Alternative contact number">
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
    </div>

  <script>
    document.addEventListener('alpine:init', () => {
      Alpine.data('customerPanel', () => ({
        open: false,
        mode: 'create',
        saving: false,
        id: null,
        form: { name: '', customer_ref: '', trn_number: '', phone: '', alternate_number: '' },

        openCreate() {
          this.mode = 'create';
          this.id = null;
          this.form = { name: '', customer_ref: '', trn_number: '', phone: '', alternate_number: '' };
          this.open = true;
        },
        openEdit(id, customer) {
          this.mode = 'edit';
          this.id = id;
          this.form = {
            name: customer.name || '',
            customer_ref: customer.customer_ref || '',
            trn_number: customer.trn_number || '',
            phone: customer.phone || '',
            alternate_number: customer.alternate_number || '',
          };
          this.open = true;
        },
        close() { this.open = false; },

        async submit() {
          this.saving = true;
          try {
            const url = this.mode === 'create'
              ? @js(route('customers.store'))
              : @js(url('/customers')) + '/' + this.id;

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
            alert(e?.message || 'Failed to save customer.');
          } finally {
            this.saving = false;
          }
        },

        async confirmDelete(id) {
          if (!confirm('Delete this customer?')) return;
          try {
            const res = await fetch(@js(url('/customers')) + '/' + id, {
              method: 'DELETE',
              headers: {
                'Accept': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
              },
            });
            if (!res.ok) throw await res.json();
            window.location.reload();
          } catch (e) {
            alert(e?.message || 'Failed to delete customer.');
          }
        }
      }))
    })
  </script>
  </div>
@endsection

