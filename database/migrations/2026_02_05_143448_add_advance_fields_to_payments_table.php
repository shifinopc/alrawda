<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            // Link payments directly to a customer so we can record
            // advance payments not tied to a specific invoice.
            $table->foreignId('customer_id')
                ->nullable()
                ->after('id')
                ->constrained()
                ->cascadeOnDelete();

            // Track whether a payment is an advance credit and the remaining
            // unused portion of that credit.
            $table->boolean('is_advance')
                ->default(false)
                ->after('notes');

            $table->decimal('remaining_amount', 12, 2)
                ->nullable()
                ->after('amount');
        });

        // Allow payments to exist without an invoice when they are advances.
        DB::statement('ALTER TABLE payments MODIFY invoice_id BIGINT UNSIGNED NULL;');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropColumn(['customer_id', 'is_advance', 'remaining_amount']);
        });

        // We intentionally do not force invoice_id back to NOT NULL here to
        // avoid failures if any advance payments without invoices exist.
    }
};
