<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('packages', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('discount_type', 20)->nullable(); // 'percentage' | 'fixed'
            $table->decimal('discount_value', 12, 2)->nullable();
            $table->string('rounding_rule', 20)->nullable(); // 'nearest_5' | 'nearest_10' | 'nearest_50' | 'custom'
            $table->decimal('rounding_target', 12, 2)->nullable(); // for 'custom' (e.g. 670)
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('packages');
    }
};
