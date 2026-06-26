<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('package_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('package_id')->constrained()->cascadeOnDelete();
            $table->foreignId('service_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('quantity')->default(1);
            $table->decimal('taxable_amount', 12, 2)->nullable(); // override per unit; null = use service's
            $table->decimal('non_taxable_amount', 12, 2)->nullable(); // override per unit; null = use service's
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('package_items');
    }
};
