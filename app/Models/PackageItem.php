<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PackageItem extends Model
{
    protected $fillable = [
        'package_id',
        'service_id',
        'quantity',
        'taxable_amount',
        'non_taxable_amount',
    ];

    protected $casts = [
        'quantity' => 'integer',
        'taxable_amount' => 'decimal:2',
        'non_taxable_amount' => 'decimal:2',
    ];

    public function package(): BelongsTo
    {
        return $this->belongsTo(Package::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }

    /**
     * Taxable amount per unit: override from package_item or from service.
     */
    public function getTaxablePerUnitAttribute(): float
    {
        return $this->taxable_amount !== null
            ? (float) $this->taxable_amount
            : (float) $this->service->taxable_amount;
    }

    /**
     * Non-taxable amount per unit: override from package_item or from service.
     */
    public function getNonTaxablePerUnitAttribute(): float
    {
        return $this->non_taxable_amount !== null
            ? (float) $this->non_taxable_amount
            : (float) $this->service->non_taxable_amount;
    }

    /**
     * Line taxable for this item (per unit × quantity).
     */
    public function getLineTaxableAttribute(): float
    {
        return round($this->taxable_per_unit * $this->quantity, 2);
    }

    /**
     * Line non-taxable for this item (per unit × quantity).
     */
    public function getLineNonTaxableAttribute(): float
    {
        return round($this->non_taxable_per_unit * $this->quantity, 2);
    }
}
