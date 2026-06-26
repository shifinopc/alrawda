@extends('layouts.app')

@section('title', 'Edit Role')
@section('subtitle', $role->name)

@section('content')
  <div class="space-y-4">
    @include('settings._nav')

    <div class="card p-5">
      <div class="text-sm font-semibold mb-4">Permissions for {{ $role->name }}</div>
      <div class="text-xs text-slate-500 mb-4">Select which actions this role can perform for each menu.</div>

      <form method="POST" action="{{ route('settings.roles.update', $role) }}">
        @csrf
        @method('PUT')
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr>
                <th class="table-th text-left">Menu / Resource</th>
                @foreach(['view', 'create', 'edit', 'approve', 'withdraw', 'delete'] as $action)
                  <th class="table-th text-center capitalize">{{ $action }}</th>
                @endforeach
              </tr>
            </thead>
            <tbody>
              @foreach(\App\Models\Role::RESOURCES() as $resource)
                @php $actionsForResource = \App\Models\Role::ACTIONS_FOR_RESOURCE($resource); @endphp
                <tr class="hover:bg-slate-50">
                  <td class="table-td font-semibold capitalize">{{ $resource }}</td>
                  @foreach(['view', 'create', 'edit', 'approve', 'withdraw', 'delete'] as $action)
                    <td class="table-td text-center">
                      @if(in_array($action, $actionsForResource))
                        <input type="checkbox" name="{{ $resource }}_{{ $action }}" value="1"
                               @checked($role->hasPermission($resource, $action))>
                      @else
                        <span class="text-slate-300">—</span>
                      @endif
                    </td>
                  @endforeach
                </tr>
              @endforeach
            </tbody>
          </table>
        </div>
        <div class="mt-6 flex gap-2">
          <button class="btn-primary" type="submit">Update Permissions</button>
          <a class="btn-ghost" href="{{ route('settings.users') }}">Cancel</a>
        </div>
      </form>
    </div>
  </div>
@endsection
