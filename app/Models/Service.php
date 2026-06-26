<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Service extends Model
{
    protected $fillable = [
        'name',
        'description',
        'taxable_amount',
        'non_taxable_amount',
    ];

    protected $casts = [
        'taxable_amount' => 'decimal:2',
        'non_taxable_amount' => 'decimal:2',
    ];

    public function invoiceItems(): HasMany
    {
        return $this->hasMany(InvoiceItem::class);
    }
}
