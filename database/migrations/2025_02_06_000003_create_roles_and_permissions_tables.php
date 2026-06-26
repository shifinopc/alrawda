<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->timestamps();
        });

        Schema::create('role_user', function (Blueprint $table) {
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->primary(['role_id', 'user_id']);
        });

        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->string('resource');
            $table->string('action');
            $table->unique(['role_id', 'resource', 'action']);
        });

        // Seed admin role with full permissions
        $adminId = DB::table('roles')->insertGetId(['name' => 'Admin', 'slug' => 'admin', 'created_at' => now(), 'updated_at' => now()]);
        $resources = ['dashboard', 'customers', 'services', 'invoices', 'payments', 'reports', 'settings', 'users'];
        $actions = ['view', 'create', 'edit', 'approve', 'delete'];
        foreach ($resources as $resource) {
            foreach ($actions as $action) {
                DB::table('permissions')->insert(['role_id' => $adminId, 'resource' => $resource, 'action' => $action]);
            }
        }
        foreach (DB::table('users')->pluck('id') as $userId) {
            DB::table('role_user')->insert(['role_id' => $adminId, 'user_id' => $userId]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('role_user');
        Schema::dropIfExists('roles');
    }
};
