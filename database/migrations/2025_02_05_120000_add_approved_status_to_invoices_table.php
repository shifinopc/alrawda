<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE invoices MODIFY COLUMN status ENUM('draft', 'approved', 'partially_paid', 'paid') DEFAULT 'draft'");
    }

    public function down(): void
    {
        // Convert approved back to draft before reverting
        DB::table('invoices')->where('status', 'approved')->update(['status' => 'draft']);
        DB::statement("ALTER TABLE invoices MODIFY COLUMN status ENUM('draft', 'partially_paid', 'paid') DEFAULT 'draft'");
    }
};
