<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CompanySetting extends Model
{
    protected $fillable = [
        'company_name',
        'email',
        'phone',
        'address',
        'trn_number',
        'logo_path',
        'revenue_target',
    ];

    protected $casts = [
        'revenue_target' => 'decimal:2',
    ];
}
