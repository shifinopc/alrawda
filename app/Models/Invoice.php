<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    protected $fillable = [
        'invoice_number',
        'customer_id',
        'invoice_date',
        'due_date',
        'subtotal_taxable',
        'subtotal_non_taxable',
        'vat_amount',
        'discount_amount',
        'rounding_adjustment',
        'grand_total',
        'status',
        'notes',
    ];

    protected $casts = [
        'invoice_date' => 'date',
        'due_date' => 'date',
        'subtotal_taxable' => 'decimal:2',
        'subtotal_non_taxable' => 'decimal:2',
        'vat_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'rounding_adjustment' => 'decimal:2',
        'grand_total' => 'decimal:2',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(InvoiceItem::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function activities(): HasMany
    {
        return $this->hasMany(InvoiceActivity::class);
    }

    public function totalPaid(): float
    {
        return (float) $this->payments()->sum('amount');
    }

    public function outstandingAmount(): float
    {
        return (float) $this->grand_total - $this->totalPaid();
    }

    public function addActivity(string $event, ?string $description = null): void
    {
        $user = auth()->user();

        $this->activities()->create([
            'event' => $event,
            'description' => $description,
            'performed_by' => $user?->name,
        ]);
    }
}
