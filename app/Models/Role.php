<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Role extends Model
{
    protected $fillable = ['name', 'slug'];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'role_user');
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(Permission::class);
    }

    public function hasPermission(string $resource, string $action): bool
    {
        return $this->permissions()->where('resource', $resource)->where('action', $action)->exists();
    }

    public static function RESOURCES(): array
    {
        return ['dashboard', 'customers', 'services', 'invoices', 'payments', 'reports', 'settings', 'users'];
    }

    /** Actions available per resource (business rules). */
    public static function ACTIONS_FOR_RESOURCE(string $resource): array
    {
        return match ($resource) {
            'dashboard' => ['view'],
            'customers' => ['view', 'create', 'edit', 'delete'],
            'services' => ['view', 'create', 'edit', 'delete'],
            'invoices' => ['view', 'create', 'edit', 'delete', 'approve', 'withdraw'],
            'payments' => ['view', 'create', 'delete'],
            'reports' => ['view'],
            'settings' => ['view'],
            'users' => ['view'],
            default => ['view'],
        };
    }

    /** All unique actions (for backward compatibility). */
    public static function ACTIONS(): array
    {
        $actions = [];
        foreach (self::RESOURCES() as $resource) {
            $actions = array_unique(array_merge($actions, self::ACTIONS_FOR_RESOURCE($resource)));
        }
        return array_values($actions);
    }
}
