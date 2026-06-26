<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PaymentNumberSetting extends Model
{
    protected $fillable = ['prefix', 'next_number', 'padding'];

    protected $casts = [
        'next_number' => 'integer',
        'padding' => 'integer',
    ];
}
