<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InvoiceTemplateSetting extends Model
{
    protected $fillable = ['header_image_path', 'footer_image_path'];
}
