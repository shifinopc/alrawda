<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->decimal('discount_amount', 12, 2)->default(0)->after('vat_amount');
            $table->decimal('rounding_adjustment', 12, 2)->default(0)->after('discount_amount'); // positive = add, negative = reduce
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn(['discount_amount', 'rounding_adjustment']);
        });
    }
};
