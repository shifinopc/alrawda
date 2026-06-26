@extends('layouts.app')

@section('title', 'Invoice ' . $invoice->invoice_number)
@section('subtitle', 'Review invoice, download PDF, record payments')

@section('content')
  <div x-data="{ payOpen: false, previewOpen: false, applyAdvanceOpen: false, activityOpen: false, approving:false, withdrawing:false, emailing:false }">
  <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
    <div class="flex items-center gap-2">
      <a class="btn-ghost" href="{{ route('invoices.index') }}">← Back</a>
      <button class="btn-ghost" type="button" @click="previewOpen = true">Preview</button>
      <a class="btn-primary" href="{{ route('invoices.pdf', $invoice) }}">Download PDF</a>
    </div>

    <div class="flex items-center gap-2">
      @php
        $badge = match($invoice->status) {
          'approved' => 'bg-emerald-100 text-emerald-800 border-emerald-200 font-semibold',
          'paid' => 'bg-emerald-50 text-emerald-700 border-emerald-100',
          'partially_paid' => 'bg-amber-50 text-amber-700 border-amber-100',
          default => 'bg-slate-50 text-slate-700 border-slate-100',
        };
      @endphp
      <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold {{ $badge }}">
        {{ ucfirst(str_replace('_', ' ', $invoice->status)) }}
      </span>
      <span class="text-xs text-slate-500">
        Outstanding: <span class="font-semibold text-slate-700">{{ number_format($invoice->outstandingAmount(), 2) }} AED</span>
      </span>
      @if($invoice->status === 'draft')
        <a class="btn-ghost" href="{{ route('invoices.edit', $invoice) }}">Edit</a>
        <form method="POST" action="{{ route('invoices.approve', $invoice) }}" class="inline"
              x-on:submit="$root.pageLoading = true; approving = true">
          @csrf
          <button class="btn-primary flex items-center gap-1" type="submit" :disabled="approving">
            <svg x-show="approving" class="h-3 w-3 animate-spin text-white" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <span x-text="approving ? 'Approving...' : 'Approve Invoice'"></span>
          </button>
        </form>
        <form method="POST" action="{{ route('invoices.destroy', $invoice) }}" class="inline"
              onsubmit="return confirm('Delete this draft invoice? This cannot be undone.');">
          @csrf
          @method('DELETE')
          <button class="btn-ghost text-rose-600" type="submit">Delete</button>
        </form>
      @elseif($invoice->status === 'approved')
        <button class="btn-ghost" type="button" @click="activityOpen = true">Activity Log</button>
        @if($invoice->totalPaid() == 0)
          <form method="POST" action="{{ route('invoices.withdraw', $invoice) }}" class="inline"
                x-on:submit="$root.pageLoading = true; withdrawing = true"
                onsubmit="return confirm('Move this invoice back to draft?');">
            @csrf
            <button class="btn-ghost text-xs flex items-center gap-1" type="submit" :disabled="withdrawing">
              <svg x-show="withdrawing" class="h-3 w-3 animate-spin text-slate-700" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              <span x-text="withdrawing ? 'Withdrawing...' : 'Withdraw'"></span>
            </button>
          </form>
        @endif
        @if(($invoice->customer->email ?? null) && $invoice->outstandingAmount() > 0)
          <form method="POST" action="{{ route('invoices.send-email', $invoice) }}" class="inline"
                x-on:submit="$root.pageLoading = true; emailing = true">
            @csrf
            <button class="btn-ghost text-xs flex items-center gap-1" type="submit" :disabled="emailing">
              <svg x-show="emailing" class="h-3 w-3 animate-spin text-slate-700" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              <span x-text="emailing ? 'Sending...' : 'Send to Customer'"></span>
            </button>
          </form>
        @endif
      @elseif(($invoice->customer->email ?? null) && $invoice->outstandingAmount() > 0)
        <form method="POST" action="{{ route('invoices.send-email', $invoice) }}" class="inline"
              x-on:submit="$root.pageLoading = true; emailing = true">
          @csrf
          <button class="btn-ghost text-xs flex items-center gap-1" type="submit" :disabled="emailing">
            <svg x-show="emailing" class="h-3 w-3 animate-spin text-slate-700" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <span x-text="emailing ? 'Sending...' : 'Send to Customer'"></span>
          </button>
        </form>
      @endif
    </div>
  </div>

  <div>
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div class="xl:col-span-2 space-y-4">
      <div class="card p-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div class="text-xs font-semibold text-slate-500">Customer</div>
            <div class="mt-1 text-sm font-semibold">{{ $invoice->customer->name }}</div>
            @if($invoice->customer->customer_ref)
              <div class="text-xs text-slate-500 mt-1">Ref: <span class="font-semibold">{{ $invoice->customer->customer_ref }}</span></div>
            @endif
            @if($invoice->customer->trn_number)
              <div class="text-xs text-slate-500 mt-1">TRN: <span class="font-semibold">{{ $invoice->customer->trn_number }}</span></div>
            @endif
            @if($invoice->customer->phone)
              <div class="text-xs text-slate-500 mt-1">Mobile: {{ $invoice->customer->phone }}</div>
            @endif
            @if($invoice->customer->alternate_number)
              <div class="text-xs text-slate-500 mt-1">Alternate: {{ $invoice->customer->alternate_number }}</div>
            @endif
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-500">Invoice Details</div>
            <div class="mt-1 text-sm text-slate-700">
              <div>Invoice No: <span class="font-semibold">{{ $invoice->invoice_number }}</span></div>
              <div>Date: <span class="font-semibold">{{ $invoice->invoice_date?->format('d M Y') }}</span></div>
              @if($invoice->due_date)
              <div>Due: <span class="font-semibold">{{ $invoice->due_date->format('d M Y') }}</span></div>
              @endif
            </div>
          </div>
        </div>
        @if($invoice->notes)
          <div class="mt-4 text-sm text-slate-600">
            <div class="text-xs font-semibold text-slate-500">Notes</div>
            <div class="mt-1">{{ $invoice->notes }}</div>
          </div>
        @endif
      </div>

      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100">
          <div class="text-sm font-semibold">Service Breakdown</div>
          <div class="text-xs text-slate-500">Tax is calculated only on taxable components.</div>
        </div>
        <div class="overflow-auto">
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="table-th">Service / Package</th>
                <th class="table-th">Qty</th>
                <th class="table-th">Non‑Taxable</th>
                <th class="table-th">Taxable</th>
                <th class="table-th">VAT</th>
                <th class="table-th">Line Total</th>
              </tr>
            </thead>
            <tbody>
              @foreach($invoice->items as $it)
                <tr class="hover:bg-slate-50 transition">
                  <td class="table-td font-semibold">{{ $it->package_id ? $it->package->name : $it->service->name }}</td>
                  <td class="table-td">{{ $it->quantity }}</td>
                  <td class="table-td">{{ number_format((float) $it->non_taxable_amount, 2) }}</td>
                  <td class="table-td">{{ number_format((float) $it->taxable_amount, 2) }}</td>
                  <td class="table-td">{{ number_format((float) $it->line_tax, 2) }}</td>
                  <td class="table-td font-semibold">{{ number_format((float) $it->line_total, 2) }}</td>
                </tr>
              @endforeach
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="space-y-4">
      <div class="card p-5">
        <div class="text-sm font-semibold">Totals</div>
        <div class="mt-4 space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-slate-600">Subtotal Taxable</span>
            <span class="font-semibold">{{ number_format((float) $invoice->subtotal_taxable, 2) }} AED</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-600">Subtotal Non‑Taxable</span>
            <span class="font-semibold">{{ number_format((float) $invoice->subtotal_non_taxable, 2) }} AED</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-600">VAT Amount</span>
            <span class="font-semibold">{{ number_format((float) $invoice->vat_amount, 2) }} AED</span>
          </div>
          @if((float) ($invoice->discount_amount ?? 0) > 0)
            <div class="flex items-center justify-between">
              <span class="text-slate-600">Discount</span>
              <span class="font-semibold">-{{ number_format((float) $invoice->discount_amount, 2) }} AED</span>
            </div>
          @endif
          @if((float) ($invoice->rounding_adjustment ?? 0) != 0)
            <div class="flex items-center justify-between">
              <span class="text-slate-600">Rounding</span>
              <span class="font-semibold">{{ (float) $invoice->rounding_adjustment >= 0 ? '+' : '' }}{{ number_format((float) $invoice->rounding_adjustment, 2) }} AED</span>
            </div>
          @endif
          <div class="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
            <span class="text-slate-900 font-semibold">Grand Total</span>
            <span class="text-slate-900 font-bold text-lg">{{ number_format((float) $invoice->grand_total, 2) }} AED</span>
          </div>
          <div class="flex items-center justify-between pt-2">
            <span class="text-slate-600">Paid</span>
            <span class="font-semibold">{{ number_format($invoice->totalPaid(), 2) }} AED</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-600">Outstanding</span>
            <span class="font-semibold">{{ number_format($invoice->outstandingAmount(), 2) }} AED</span>
          </div>
          @if($advanceBalance > 0)
            <div class="mt-2 flex items-center justify-between text-xs">
              <span class="text-slate-600">Customer Advance Available</span>
              <span class="font-semibold text-emerald-700">{{ number_format($advanceBalance, 2) }} AED</span>
            </div>
          @endif
        </div>

        <button class="btn-primary w-full mt-5" type="button" @click="payOpen = true">
          Add Payment
        </button>
        @if($advanceBalance > 0 && $invoice->outstandingAmount() > 0)
          <button class="btn-ghost w-full mt-2" type="button" @click="applyAdvanceOpen = true">
            Apply Advance
          </button>
        @endif
      </div>

      <div class="card overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100">
          <div class="text-sm font-semibold">Payment History</div>
          <div class="text-xs text-slate-500">Partial payments supported.</div>
        </div>
        <div class="p-5 space-y-3">
          @forelse($invoice->payments as $p)
            <div class="flex items-start justify-between rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div>
                <div class="text-sm font-semibold">{{ number_format((float) $p->amount, 2) }} AED</div>
                <div class="text-xs text-slate-500">{{ $p->payment_date?->format('d M Y') }} • {{ $p->payment_method ?? '—' }}</div>
                @if($p->reference)
                  <div class="text-xs text-slate-500">Ref: {{ $p->reference }}</div>
                @endif
              </div>
            </div>
          @empty
            <div class="text-sm text-slate-500">No payments recorded yet.</div>
          @endforelse
        </div>
      </div>
    </div>

    <!-- Payment modal -->
    <div class="fixed inset-0 z-50" x-show="payOpen" x-transition.opacity style="display:none">
      <div class="absolute inset-0 bg-slate-900/30" @click="payOpen=false"></div>
      <div class="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center p-4">
        <div class="w-full max-w-lg card p-6"
             x-transition:enter="transition duration-200 ease-in-out"
             x-transition:enter-start="opacity-0 scale-95 translate-y-2"
             x-transition:enter-end="opacity-100 scale-100 translate-y-0"
             x-transition:leave="transition duration-200 ease-in-out"
             x-transition:leave-start="opacity-100 scale-100 translate-y-0"
             x-transition:leave-end="opacity-0 scale-95 translate-y-2"
        >
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="text-sm font-semibold">Add Payment</div>
              <div class="text-xs text-slate-500">Invoice {{ $invoice->invoice_number }}</div>
            </div>
            <button class="btn-ghost" type="button" @click="payOpen=false">Close</button>
          </div>

          <form method="POST" action="{{ route('payments.store') }}" class="space-y-4" x-data="{ submitting:false }"
                x-on:submit="$root.pageLoading = true; submitting = true">
            @csrf
            <input type="hidden" name="invoice_id" value="{{ $invoice->id }}">

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="label">Amount (AED)</label>
                <input name="amount" type="number" min="0.01" step="0.01" class="input mt-1" required>
              </div>
              <div>
                <label class="label">Payment Date</label>
                <input name="payment_date" type="date" value="{{ now()->toDateString() }}" class="input mt-1" required>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="label">Method</label>
                <input name="payment_method" class="input mt-1" placeholder="Cash / Card / Bank">
              </div>
              <div>
                <label class="label">Reference</label>
                <input name="reference" class="input mt-1" placeholder="Receipt / Txn ID">
              </div>
            </div>

            <div>
              <label class="label">Notes</label>
              <textarea name="notes" class="input mt-1" rows="2"></textarea>
            </div>

            <div class="flex items-center justify-end gap-2 pt-2">
              <button class="btn-ghost" type="button" @click="payOpen=false">Cancel</button>
              <button class="btn-primary flex items-center gap-1" type="submit" :disabled="submitting">
                <svg x-show="submitting" class="h-3 w-3 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                <span x-text="submitting ? 'Saving...' : 'Save Payment'"></span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Apply advance modal -->
    <div class="fixed inset-0 z-50" x-show="applyAdvanceOpen" x-transition.opacity style="display:none">
      <div class="absolute inset-0 bg-slate-900/30" @click="applyAdvanceOpen=false"></div>
      <div class="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center p-4">
        <div class="w-full max-w-lg card p-6"
             x-transition:enter="transition duration-200 ease-in-out"
             x-transition:enter-start="opacity-0 scale-95 translate-y-2"
             x-transition:enter-end="opacity-100 scale-100 translate-y-0"
             x-transition:leave="transition duration-200 ease-in-out"
             x-transition:leave-start="opacity-100 scale-100 translate-y-0"
             x-transition:leave-end="opacity-0 scale-95 translate-y-2"
        >
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="text-sm font-semibold">Apply Advance</div>
              <div class="text-xs text-slate-500">
                Available: {{ number_format($advanceBalance, 2) }} AED • Outstanding: {{ number_format($invoice->outstandingAmount(), 2) }} AED
              </div>
            </div>
            <button class="btn-ghost" type="button" @click="applyAdvanceOpen=false">Close</button>
          </div>

          <form method="POST" action="{{ route('payments.apply-advance', $invoice) }}" class="space-y-4" x-data="{ submitting:false }"
                x-on:submit="$root.pageLoading = true; submitting = true">
            @csrf
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="label">Amount to apply (AED)</label>
                <input name="amount" type="number" min="0.01" step="0.01" class="input mt-1" required>
              </div>
              <div>
                <label class="label">Apply Date</label>
                <input name="payment_date" type="date" value="{{ now()->toDateString() }}" class="input mt-1" required>
              </div>
            </div>
            <div>
              <label class="label">Notes (optional)</label>
              <textarea name="notes" class="input mt-1" rows="2" placeholder="e.g. Settling advance received earlier"></textarea>
            </div>
            <div class="flex items-center justify-end gap-2 pt-2">
              <button class="btn-ghost" type="button" @click="applyAdvanceOpen=false">Cancel</button>
              <button class="btn-primary flex items-center gap-1" type="submit" :disabled="submitting">
                <svg x-show="submitting" class="h-3 w-3 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                <span x-text="submitting ? 'Applying...' : 'Apply Advance'"></span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Slide-over PDF preview -->
    <div class="fixed inset-0 z-40" x-show="previewOpen" x-transition.opacity style="display:none">
      <div class="absolute inset-0 bg-slate-900/40" @click="previewOpen = false"></div>
      <div class="absolute inset-y-0 right-0 w-full max-w-3xl bg-white shadow-lift"
           x-transition:enter="transition duration-200 ease-in-out"
           x-transition:enter-start="translate-x-full opacity-0"
           x-transition:enter-end="translate-x-0 opacity-100"
           x-transition:leave="transition duration-200 ease-in-out"
           x-transition:leave-start="translate-x-0 opacity-100"
           x-transition:leave-end="translate-x-full opacity-0"
      >
        <div class="h-full flex flex-col">
          <div class="px-4 sm:px-6 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div class="text-sm font-semibold">Invoice Preview</div>
              <div class="text-xs text-slate-500">Invoice {{ $invoice->invoice_number }}</div>
            </div>
            <button class="btn-ghost text-xs" type="button" @click="previewOpen = false">Close</button>
          </div>
          <div class="flex-1 bg-slate-100">
            <iframe
              src="{{ route('invoices.pdf', ['invoice' => $invoice, 'preview' => 1]) }}"
              style="width:100%;height:100%;border:0;"
            ></iframe>
          </div>
        </div>
      </div>
    </div>

    <!-- Activity log slide-over (approved invoices only) -->
    @if($invoice->status === 'approved')
      <div class="fixed inset-0 z-40" x-show="activityOpen" x-transition.opacity style="display:none">
        <div class="absolute inset-0 bg-slate-900/40" @click="activityOpen = false"></div>
        <div class="absolute inset-y-0 right-0 w-full max-w-md bg-white shadow-lift"
             x-transition:enter="transition duration-200 ease-in-out"
             x-transition:enter-start="translate-x-full opacity-0"
             x-transition:enter-end="translate-x-0 opacity-100"
             x-transition:leave="transition duration-200 ease-in-out"
             x-transition:leave-start="translate-x-0 opacity-100"
             x-transition:leave-end="translate-x-full opacity-0"
        >
          <div class="h-full flex flex-col">
            <div class="px-4 sm:px-6 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div class="text-sm font-semibold">Activity Log</div>
                <div class="text-xs text-slate-500">Invoice {{ $invoice->invoice_number }}</div>
              </div>
              <button class="btn-ghost text-xs" type="button" @click="activityOpen = false">Close</button>
            </div>
            <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              @forelse($invoice->activities as $activity)
                <div class="flex items-start gap-3">
                  <div class="mt-1 h-2 w-2 rounded-full bg-brand-500"></div>
                  <div class="flex-1">
                    <div class="text-xs text-slate-500">
                      {{ $activity->created_at?->format('d M Y, h:i A') }}
                      @if($activity->performed_by)
                        • {{ $activity->performed_by }}
                      @endif
                    </div>
                    <div class="text-sm font-semibold mt-0.5">
                      {{ ucfirst(str_replace('_', ' ', $activity->event)) }}
                    </div>
                    @if($activity->description)
                      <div class="text-xs text-slate-600 mt-0.5">
                        {{ $activity->description }}
                      </div>
                    @endif
                  </div>
                </div>
              @empty
                <div class="text-xs text-slate-500">
                  No activity recorded yet for this invoice.
                </div>
              @endforelse
            </div>
          </div>
        </div>
      </div>
    @endif
  </div>
  </div>
@endsection

