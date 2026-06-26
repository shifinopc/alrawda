<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_number_settings', function (Blueprint $table) {
            $table->id();
            $table->string('prefix')->default('INV');
            $table->unsignedBigInteger('next_number')->default(1);
            $table->integer('padding')->default(5);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_number_settings');
    }
};
