<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_number_settings', function (Blueprint $table) {
            $table->id();
            $table->string('prefix')->default('PAY');
            $table->unsignedBigInteger('next_number')->default(1);
            $table->integer('padding')->default(5);
            $table->timestamps();
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->string('payment_number')->nullable()->after('id');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropColumn('payment_number');
        });
        Schema::dropIfExists('payment_number_settings');
    }
};
