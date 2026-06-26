@extends('layouts.app')

@section('title', 'Edit User')
@section('subtitle', $user->name)

@section('content')
  <div class="space-y-4">
    @include('settings._nav')

    <div class="card p-5 max-w-xl">
      <form method="POST" action="{{ route('settings.users.update', $user) }}" class="space-y-4">
        @csrf
        @method('PUT')
        <div>
          <label class="label">Name</label>
          <input class="input mt-1" name="name" value="{{ old('name', $user->name) }}" required>
        </div>
        <div>
          <label class="label">Email</label>
          <input class="input mt-1" name="email" type="email" value="{{ old('email', $user->email) }}" required>
        </div>
        <div>
          <label class="label">New Password (leave blank to keep current)</label>
          <input class="input mt-1" name="password" type="password">
        </div>
        <div>
          <label class="label">Confirm Password</label>
          <input class="input mt-1" name="password_confirmation" type="password">
        </div>
        <div>
          <label class="label">Role</label>
          <select class="input mt-1" name="role_id" required>
            @foreach($roles as $r)
              <option value="{{ $r->id }}" @selected(old('role_id', $user->roles->first()?->id)==$r->id)>{{ $r->name }}</option>
            @endforeach
          </select>
        </div>
        <div class="flex gap-2">
          <button class="btn-primary" type="submit">Update User</button>
          <a class="btn-ghost" href="{{ route('settings.users') }}">Cancel</a>
        </div>
      </form>
    </div>
  </div>
@endsection
