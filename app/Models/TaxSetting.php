<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TaxSetting extends Model
{
    protected $fillable = ['vat_percentage', 'vat_enabled'];

    protected $casts = [
        'vat_enabled' => 'boolean',
        'vat_percentage' => 'decimal:2',
    ];
}
