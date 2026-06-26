<?php

namespace Database\Seeders;

use App\Models\CompanySetting;
use App\Models\InvoiceNumberSetting;
use App\Models\InvoiceTemplateSetting;
use App\Models\TaxSetting;
use Illuminate\Database\Seeder;

class SettingsSeeder extends Seeder
{
    public function run(): void
    {
        if (CompanySetting::count() === 0) {
            CompanySetting::create([
                'company_name' => 'My Company',
                'email' => 'info@company.com',
                'phone' => '',
                'address' => '',
                'trn_number' => '',
            ]);
        }
        if (TaxSetting::count() === 0) {
            TaxSetting::create([
                'vat_percentage' => 5,
                'vat_enabled' => true,
            ]);
        }
        if (InvoiceTemplateSetting::count() === 0) {
            InvoiceTemplateSetting::create([
                'header_image_path' => null,
                'footer_image_path' => null,
            ]);
        }
        if (InvoiceNumberSetting::count() === 0) {
            InvoiceNumberSetting::create([
                'prefix' => 'INV',
                'next_number' => 1,
                'padding' => 5,
            ]);
        }
    }
}
