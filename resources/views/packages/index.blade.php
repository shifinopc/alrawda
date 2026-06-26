@extends('layouts.app')

@section('title', 'Packages')
@section('subtitle', 'Create packages from multiple services with optional discount and rounding')

@section('content')
  <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
    <form method="GET" class="flex flex-col sm:flex-row gap-2 w-full lg:max-w-xl">
      <input class="input" name="search" value="{{ request('search') }}" placeholder="Search packages...">
      <button class="btn-ghost" type="submit">Search</button>
    </form>
    @if(auth()->user()->isAdmin() || auth()->user()->canAccess('services', 'create'))
      <a href="{{ route('packages.create') }}" class="btn-primary">Add Package</a>
    @endif
  </div>

  <div class="card overflow-hidden">
    <div class="overflow-auto max-h-[680px]">
      <table class="min-w-full">
        <thead>
          <tr>
            <th class="table-th">Package Name</th>
            <th class="table-th">Description</th>
            <th class="table-th">Services</th>
            <th class="table-th">Raw Total (AED)</th>
            <th class="table-th">Final Total (AED)</th>
            <th class="table-th">Discount / Rounding</th>
            <th class="table-th"></th>
          </tr>
        </thead>
        <tbody>
          @forelse($packages as $pkg)
            <tr class="hover:bg-slate-50 transition">
              <td class="table-td font-semibold">{{ $pkg->name }}</td>
              <td class="table-td text-slate-500">{{ Str::limit($pkg->description, 40) ?? '—' }}</td>
              <td class="table-td">
                @foreach($pkg->items as $it)
                  <span class="text-xs bg-slate-100 rounded px-1.5 py-0.5 mr-1">{{ $it->service->name }} × {{ $it->quantity }}</span>
                @endforeach
              </td>
              <td class="table-td">{{ number_format($pkg->getRawTotalExclVat(), 2) }}</td>
              <td class="table-td font-semibold">{{ number_format($pkg->getPackageTotalExclVat(), 2) }}</td>
              <td class="table-td text-xs text-slate-500">
                @if($pkg->discount_type)
                  {{ $pkg->discount_type === 'percentage' ? $pkg->discount_value . '% off' : $pkg->discount_value . ' AED off' }}
                @endif
                @if($pkg->rounding_rule)
                  {{ $pkg->rounding_rule === 'custom' ? '→ ' . number_format((float)$pkg->rounding_target, 0) : str_replace('_', ' ', $pkg->rounding_rule) }}
                @endif
                @if(!$pkg->discount_type && !$pkg->rounding_rule)—@endif
              </td>
              <td class="table-td text-right">
                @if(auth()->user()->isAdmin() || auth()->user()->canAccess('services', 'edit'))
                  <a href="{{ route('packages.edit', $pkg) }}" class="btn-ghost text-xs">Edit</a>
                @endif
                @if(auth()->user()->isAdmin() || auth()->user()->canAccess('services', 'delete'))
                  <form action="{{ route('packages.destroy', $pkg) }}" method="POST" class="inline" onsubmit="return confirm('Delete this package?');">
                    @csrf
                    @method('DELETE')
                    <button class="btn-ghost text-xs text-rose-700" type="submit">Delete</button>
                  </form>
                @endif
              </td>
            </tr>
          @empty
            <tr>
              <td class="table-td text-slate-500" colspan="7">No packages yet. Add a package by combining services.</td>
            </tr>
          @endforelse
        </tbody>
      </table>
    </div>
    <div class="px-4 py-3 border-t border-slate-100">
      {{ $packages->links() }}
    </div>
  </div>
@endsection
