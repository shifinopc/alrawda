<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InvoiceItem extends Model
{
    protected $fillable = [
        'invoice_id',
        'service_id',
        'package_id',
        'quantity',
        'taxable_amount',
        'non_taxable_amount',
        'line_tax',
        'line_total',
    ];

    protected $casts = [
        'taxable_amount' => 'decimal:2',
        'non_taxable_amount' => 'decimal:2',
        'line_tax' => 'decimal:2',
        'line_total' => 'decimal:2',
    ];

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }

    public function package(): BelongsTo
    {
        return $this->belongsTo(Package::class);
    }

    /** True if this line is a package (one line with package totals). */
    public function isPackageLine(): bool
    {
        return $this->package_id !== null;
    }
}
