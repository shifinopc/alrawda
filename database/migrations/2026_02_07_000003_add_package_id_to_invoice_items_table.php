<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_items', function (Blueprint $table) {
            $table->foreignId('package_id')->nullable()->after('invoice_id')->constrained()->nullOnDelete();
        });

        Schema::table('invoice_items', function (Blueprint $table) {
            $table->unsignedBigInteger('service_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('invoice_items', function (Blueprint $table) {
            $table->dropForeign(['package_id']);
        });

        Schema::table('invoice_items', function (Blueprint $table) {
            $table->unsignedBigInteger('service_id')->nullable(false)->change();
        });
    }
};
