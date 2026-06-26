@extends('layouts.app')

@section('title', 'Settings')
@section('subtitle', 'Users and roles')

@section('content')
  <div class="space-y-4">
    @include('settings._nav')

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {{-- Users --}}
      <div class="card p-5">
        <div class="text-sm font-semibold">Users</div>
        <div class="text-xs text-slate-500 mb-4">Create and manage users. Assign roles to control access.</div>

        <form method="POST" action="{{ route('settings.users.store') }}" class="mb-6 p-4 rounded-lg bg-slate-50 space-y-3">
          @csrf
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="label text-xs">Name</label>
              <input class="input mt-1" name="name" value="{{ old('name') }}" required>
            </div>
            <div>
              <label class="label text-xs">Email</label>
              <input class="input mt-1" name="email" type="email" value="{{ old('email') }}" required>
            </div>
            <div>
              <label class="label text-xs">Password</label>
              <input class="input mt-1" name="password" type="password" required>
            </div>
            <div>
              <label class="label text-xs">Confirm Password</label>
              <input class="input mt-1" name="password_confirmation" type="password" required>
            </div>
            <div>
              <label class="label text-xs">Role</label>
              <select class="input mt-1" name="role_id" required>
                @foreach($roles as $r)
                  <option value="{{ $r->id }}" @selected(old('role_id')==$r->id)>{{ $r->name }}</option>
                @endforeach
              </select>
            </div>
          </div>
          <button class="btn-primary text-sm" type="submit">Create User</button>
        </form>

        <table class="min-w-full">
          <thead>
            <tr>
              <th class="table-th">Name</th>
              <th class="table-th">Email</th>
              <th class="table-th">Role</th>
              <th class="table-th"></th>
            </tr>
          </thead>
          <tbody>
            @foreach($users as $u)
              <tr class="hover:bg-slate-50">
                <td class="table-td font-semibold">{{ $u->name }}</td>
                <td class="table-td">{{ $u->email }}</td>
                <td class="table-td">{{ $u->roles->first()?->name ?? '-' }}</td>
                <td class="table-td text-right space-x-2">
                  <a href="{{ route('settings.users.edit', $u) }}" class="text-brand-600 hover:underline text-xs">Edit</a>
                  @if($u->id !== auth()->id())
                    <form method="POST" action="{{ route('settings.users.destroy', $u) }}" class="inline" onsubmit="return confirm('Delete this user?')">
                      @csrf
                      @method('DELETE')
                      <button type="submit" class="text-rose-600 hover:underline text-xs">Delete</button>
                    </form>
                  @endif
                </td>
              </tr>
            @endforeach
          </tbody>
        </table>
      </div>

      {{-- Roles & Permissions --}}
      <div class="card p-5">
        <div class="text-sm font-semibold">Roles & Permissions</div>
        <div class="text-xs text-slate-500 mb-4">Control what each role can do. View, create, edit, approve, delete per menu.</div>
        <form method="POST" action="{{ route('settings.roles.store') }}" class="mb-4 flex gap-2">
          @csrf
          <input class="input flex-1" name="name" placeholder="New role name" required>
          <button class="btn-ghost" type="submit">Add Role</button>
        </form>
        <div class="space-y-3">
          @foreach($roles as $role)
            <div class="flex items-center justify-between p-3 rounded-lg bg-slate-50">
              <span class="font-semibold">{{ $role->name }}</span>
              <div class="flex items-center gap-3">
                <a href="{{ route('settings.roles.edit', $role) }}" class="btn-ghost text-xs">Manage permissions</a>
                @if($role->slug !== 'admin' && (auth()->user()->isAdmin() || auth()->user()->canAccess('users', 'delete')))
                  <form method="POST" action="{{ route('settings.roles.destroy', $role) }}" class="inline" onsubmit="return confirm('Delete this role? Users with this role will be affected.')">
                    @csrf
                    @method('DELETE')
                    <button type="submit" class="text-rose-600 hover:underline text-xs">Delete</button>
                  </form>
                @endif
              </div>
            </div>
          @endforeach
        </div>
      </div>
    </div>
  </div>

@endsection
