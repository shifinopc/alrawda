<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Customer extends Model
{
    protected $fillable = [
        'name',
        'customer_ref',
        'trn_number',
        'phone',
        'alternate_number',
    ];

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function advanceBalance(): float
    {
        return (float) $this->payments()
            ->where('is_advance', true)
            ->where('remaining_amount', '>', 0)
            ->sum('remaining_amount');
    }
}
