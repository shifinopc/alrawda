@php
  $items = [
    ['label' => 'Company Profile', 'route' => 'settings.company'],
    ['label' => 'Tax Settings', 'route' => 'settings.tax'],
    ['label' => 'Invoice Template', 'route' => 'settings.invoice_template'],
    ['label' => 'Numbering', 'route' => 'settings.numbering'],
    ['label' => 'Users', 'route' => 'settings.users'],
  ];
@endphp

<div class="card p-3 flex flex-col sm:flex-row gap-2">
  @foreach($items as $it)
    <a href="{{ route($it['route']) }}"
       class="rounded-lg px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 {{ request()->routeIs($it['route'].'*') ? 'bg-slate-50 text-slate-900' : 'text-slate-600' }}">
      {{ $it['label'] }}
    </a>
  @endforeach
</div>

