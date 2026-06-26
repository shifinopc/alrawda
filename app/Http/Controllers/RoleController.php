<?php

namespace App\Http\Controllers;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class RoleController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
        ]);
        $slug = \Illuminate\Support\Str::slug($validated['name']);
        if (Role::where('slug', $slug)->exists()) {
            return back()->withErrors(['name' => 'A role with this name already exists.'])->withInput();
        }
        Role::create(['name' => $validated['name'], 'slug' => $slug]);
        return back()->with('success', 'Role created.');
    }

    public function edit(Role $role): View
    {
        $role->load('permissions');
        $permissionsByResource = $role->permissions->groupBy('resource');
        return view('settings.roles-edit', compact('role', 'permissionsByResource'));
    }

    public function update(Request $request, Role $role): RedirectResponse
    {
        $resources = Role::RESOURCES();
        $role->permissions()->delete();

        foreach ($resources as $resource) {
            foreach (Role::ACTIONS_FOR_RESOURCE($resource) as $action) {
                if ($request->boolean("{$resource}_{$action}")) {
                    $role->permissions()->create(['resource' => $resource, 'action' => $action]);
                }
            }
        }

        return redirect()->route('settings.users')->with('success', 'Role permissions updated.');
    }

    public function destroy(Role $role): RedirectResponse
    {
        // Prevent deletion of Admin role
        if ($role->slug === 'admin') {
            return back()->withErrors(['error' => 'Cannot delete the Admin role.']);
        }

        // Check if role has users assigned
        if ($role->users()->exists()) {
            return back()->withErrors(['error' => 'Cannot delete a role that has users assigned to it.']);
        }

        $role->permissions()->delete();
        $role->delete();

        return back()->with('success', 'Role deleted successfully.');
    }}