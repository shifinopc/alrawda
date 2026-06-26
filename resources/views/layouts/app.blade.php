<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ config('app.name', 'Billing') }}</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@300;400;500;600;700&display=swap" rel="stylesheet">

    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            fontFamily: {
              sans: [
                "Bricolage Grotesque",
                "ui-sans-serif",
                "system-ui",
                "Segoe UI",
                "sans-serif",
              ],
            },
            borderRadius: {
              xl: "16px",
            },
            boxShadow: {
              soft: "0 10px 30px rgba(15,23,42,0.08)",
              lift: "0 16px 45px rgba(15,23,42,0.12)",
            },
            colors: {
              brand: {
                50: "#eef2ff",
                100: "#e0e7ff",
                200: "#c7d2fe",
                300: "#a5b4fc",
                400: "#818cf8",
                500: "#6366f1",
                600: "#4f46e5",
                700: "#4338ca",
                800: "#3730a3",
                900: "#312e81",
              },
            },
          },
        },
      };
    </script>
    <link rel="stylesheet" href="{{ asset('css/app.css') }}">
    <script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
  </head>
  @php
    $layoutCompany = \App\Models\CompanySetting::first();
    $layoutLogo = $layoutCompany?->logo_path ? asset('storage/'.$layoutCompany->logo_path) : asset('logo.svg');
    $layoutName = $layoutCompany?->company_name ?? config('app.name', 'Billing & Tax');
  @endphp
  <body class="min-h-screen bg-slate-100 text-slate-900 transition-colors duration-200"
        x-data="{
          sidebarOpen: false,
          sidebarCollapsed: false,
          pageLoading: false,
          init() {
            this.sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
          }
        }"
        >
    <!-- Global top loading bar -->
    <div x-show="pageLoading"
         x-transition.opacity
         class="fixed top-0 left-0 right-0 h-0.5 bg-brand-500 z-50 animate-pulse"
         style="display:none"></div>
    <div class="min-h-screen flex">
      <!-- Desktop sidebar -->
      <aside class="no-print hidden lg:flex lg:flex-col lg:shrink-0 lg:sticky lg:top-0 lg:self-start lg:h-screen bg-white border-r border-slate-100 overflow-y-auto transition-[width] duration-300 ease-in-out"
             :class="sidebarCollapsed ? 'lg:w-20' : 'lg:w-72'"
             style="scrollbar-gutter: stable;">
        <!-- Brand / logo -->
        <div class="h-16 px-4 flex items-center justify-between border-b border-slate-100">
          <div class="flex items-center">
            <div class="h-10 w-auto flex items-center justify-center overflow-hidden">
              <img src="{{ $layoutLogo }}" alt="Company logo" class="h-8 object-contain" onerror="this.style.display='none'">
              <span class="sr-only">{{ $layoutName }}</span>
            </div>
          </div>
          <button
            type="button"
            class="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xs transition-colors duration-200"
            @click="sidebarCollapsed = !sidebarCollapsed; localStorage.setItem('sidebarCollapsed', sidebarCollapsed)"
          >
            <span x-show="!sidebarCollapsed">&laquo;</span>
            <span x-show="sidebarCollapsed">&raquo;</span>
          </button>
        </div>

        <!-- Sidebar content -->
        <div class="flex-1 flex flex-col">
          <!-- Search with autocomplete -->
          <div class="px-4 pt-4 pb-3 border-b border-slate-100" x-show="!sidebarCollapsed" x-data="searchWidget()">
            <div class="relative">
              <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[11px] text-slate-400">⌕</span>
              <input type="text" placeholder="Search invoices, customer..."
                     class="input pl-8 text-xs bg-slate-50 focus:bg-white"
                     x-model="q" @input.debounce.200ms="fetch()" @focus="open = true" @click.outside="open = false">
              <div x-show="open && (suggestions.invoices?.length || suggestions.customers?.length)"
                   class="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lift border border-slate-200 py-1 max-h-64 overflow-auto z-50">
                <template x-for="item in (suggestions.invoices || [])" :key="item.id">
                  <a :href="item.url" class="block px-3 py-2 text-sm hover:bg-slate-50" x-text="item.text"></a>
                </template>
                <template x-for="item in (suggestions.customers || [])" :key="item.id">
                  <a :href="item.url" class="block px-3 py-2 text-sm hover:bg-slate-50" x-text="item.text"></a>
                </template>
              </div>
            </div>
          </div>

          <!-- Navigation -->
          <nav class="flex-1 px-2 py-4 space-y-4 text-sm">
            @php
              $navGroups = [
                [
                  'heading' => 'GENERAL',
                  'items' => [
                    ['label' => 'Dashboard', 'route' => 'dashboard', 'icon' => 'home', 'resource' => 'dashboard'],
                    ['label' => 'Customers', 'route' => 'customers.index', 'icon' => 'users', 'resource' => 'customers'],
                    ['label' => 'Services', 'route' => 'services.index', 'icon' => 'calendar', 'resource' => 'services'],
                    ['label' => 'Packages', 'route' => 'packages.index', 'icon' => 'package', 'resource' => 'services'],
                  ],
                ],
                [
                  'heading' => 'BILLING',
                  'items' => [
                    ['label' => 'Invoices', 'route' => 'invoices.index', 'icon' => 'document', 'resource' => 'invoices'],
                    ['label' => 'Payments', 'route' => 'payments.index', 'icon' => 'payment', 'resource' => 'payments'],
                    ['label' => 'Reports', 'route' => 'reports.customers', 'icon' => 'chart', 'resource' => 'reports'],
                  ],
                ],
                [
                  'heading' => 'SUPPORT',
                  'items' => [
                    ['label' => 'Settings', 'route' => 'settings.company', 'icon' => 'settings', 'resource' => 'settings'],
                    ['label' => 'Users', 'route' => 'settings.users', 'icon' => 'users', 'resource' => 'users'],
                  ],
                ],
              ];
              $navGroups = array_map(fn ($g) => [
                'heading' => $g['heading'],
                'items' => array_filter($g['items'], fn ($i) => auth()->user()->isAdmin() || auth()->user()->canAccess($i['resource'] ?? 'dashboard', 'view')),
              ], $navGroups);
              $navGroups = array_filter($navGroups, fn ($g) => count($g['items']) > 0);
            @endphp

            @foreach($navGroups as $group)
              <div>
                <div class="px-3 mb-1 text-[11px] font-semibold tracking-wide text-slate-400"
                     x-show="!sidebarCollapsed">
                  {{ $group['heading'] }}
                </div>

                @foreach($group['items'] as $item)
                  @php
                    $active = request()->routeIs($item['route'].'*');
                  @endphp
                  <a
                    href="{{ route($item['route']) }}"
                    class="group flex items-center rounded-full px-2 py-1.5 transition duration-200 ease-in-out
                           {{ $active ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-slate-600 hover:bg-slate-50' }}"
                    :class="sidebarCollapsed ? 'justify-center mx-auto w-10 h-10' : 'gap-3'"
                  >
                    <span class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-[13px]">
                      @if($item['icon'] === 'home')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"/>
                        </svg>
                      @elseif($item['icon'] === 'users')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/>
                          <path d="M3.5 18a5.5 5.5 0 0 1 11 0M14.5 18a4.5 4.5 0 0 1 7-3.5"/>
                        </svg>
                      @elseif($item['icon'] === 'calendar')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <rect x="4" y="5" width="16" height="15" rx="2"/>
                          <path d="M9 3v4M15 3v4M4 10h16"/>
                        </svg>
                      @elseif($item['icon'] === 'package')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <path d="M12 22v-9M12 13L3.5 8 12 3l8.5 5L12 13z"/>
                          <path d="m3.5 8 8.5 5v9l-8.5-5v-9M20.5 8l-8.5 5v9l8.5-5v-9"/>
                        </svg>
                      @elseif($item['icon'] === 'document')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <path d="M7 4h7l5 5v11H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>
                          <path d="M14 4v5h5"/>
                        </svg>
                      @elseif($item['icon'] === 'payment')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <rect x="3" y="5" width="18" height="14" rx="2"/>
                          <path d="M3 10h18M8 14h3"/>
                        </svg>
                      @elseif($item['icon'] === 'chart')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <path d="M4 19h16M6 16l3-6 4 5 5-9"/>
                        </svg>
                      @elseif($item['icon'] === 'settings')
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <circle cx="12" cy="12" r="3"/>
                          <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1 .6 1.8 1.8 0 0 0-.44 1.23V22a2 2 0 0 1-4 0v-.07A1.8 1.8 0 0 0 9 19.4a1.8 1.8 0 0 0-1-.6 1.8 1.8 0 0 0-1.98.36l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-.6-1 1.8 1.8 0 0 0-1.23-.44H2a2 2 0 0 1 0-4h.07A1.8 1.8 0 0 0 4.6 9a1.8 1.8 0 0 0-.6-1 1.8 1.8 0 0 0-1.98-.36l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.8 1.8 0 0 0 4.6 4.6 1.8 1.8 0 0 0 5 3.4 1.8 1.8 0 0 0 5.44 2.17L5.47 2A2 2 0 0 1 9 2v.07A1.8 1.8 0 0 0 9 4.6a1.8 1.8 0 0 0 1 .6 1.8 1.8 0 0 0 1.23-.44l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.8 1.8 0 0 0 19.4 9a1.8 1.8 0 0 0 1-.6 1.8 1.8 0 0 0 .44-1.23V7a2 2 0 0 1 4 0v.07A1.8 1.8 0 0 0 22 9.56a1.8 1.8 0 0 0-1 .6 1.8 1.8 0 0 0-.44 1.23A1.8 1.8 0 0 0 22 13h.07a2 2 0 0 1 0 4h-.07a1.8 1.8 0 0 0-1.53.84Z"/>
                        </svg>
                      @endif
                    </span>
                    <span class="whitespace-nowrap" x-show="!sidebarCollapsed">{{ $item['label'] }}</span>
                  </a>
                @endforeach
              </div>
            @endforeach
          </nav>

          <!-- Account footer -->
          <div class="px-6 py-4 border-t border-slate-100" x-show="!sidebarCollapsed">
            <div class="flex items-center justify-between gap-3">
              <div class="text-xs text-slate-500">
                <div class="font-semibold text-slate-700">
                  {{ auth()->user()->name }}
                </div>
                @if(auth()->user()->email)
                  <div class="text-[11px] text-slate-400">
                    {{ auth()->user()->email }}
                  </div>
                @endif
              </div>
              <form method="POST" action="{{ route('logout') }}">
                @csrf
                <button class="btn-ghost text-xs" type="submit">Logout</button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <!-- Mobile sidebar -->
      <div
        class="no-print fixed inset-0 z-40 lg:hidden"
        x-show="sidebarOpen"
        x-transition.opacity
        style="display: none;"
      >
        <div class="absolute inset-0 bg-slate-900/40" @click="sidebarOpen = false"></div>
        <aside
          class="absolute inset-y-0 left-0 w-72 bg-white border-r border-slate-100 flex flex-col"
          x-transition:enter="transition ease-out duration-200"
          x-transition:enter-start="-translate-x-full"
          x-transition:enter-end="translate-x-0"
          x-transition:leave="transition ease-in duration-150"
          x-transition:leave-start="translate-x-0"
          x-transition:leave-end="-translate-x-full"
        >
          <div class="h-16 px-4 flex items-center justify-between border-b border-slate-100">
            <div class="flex items-center gap-3">
              <div class="h-9 w-9 rounded-2xl bg-brand-600 text-white flex items-center justify-center text-sm font-bold overflow-hidden">
                <img src="{{ $layoutLogo }}" alt="Company logo" class="h-7 w-7 object-contain" onerror="this.style.display='none'">
                <span class="sr-only">{{ $layoutName }}</span>
              </div>
              <div class="text-sm font-semibold text-slate-900">
                {{ $layoutName }}
              </div>
            </div>
            <button class="btn-ghost text-xs" type="button" @click="sidebarOpen = false">Close</button>
          </div>

          <nav class="flex-1 px-3 py-4 space-y-1 text-sm overflow-y-auto">
            @php
              $mobileNav = [
                ['label' => 'Dashboard', 'route' => 'dashboard'],
                ['label' => 'Customers', 'route' => 'customers.index'],
                ['label' => 'Services', 'route' => 'services.index'],
                ['label' => 'Packages', 'route' => 'packages.index'],
                ['label' => 'Invoices', 'route' => 'invoices.index'],
                ['label' => 'Payments', 'route' => 'payments.index'],
                ['label' => 'Reports', 'route' => 'reports.customers'],
                ['label' => 'Settings', 'route' => 'settings.company'],
              ];
            @endphp
            @foreach($mobileNav as $item)
              @php
                $active = request()->routeIs($item['route'].'*');
              @endphp
              <a
                href="{{ route($item['route']) }}"
                class="group flex items-center gap-3 rounded-lg px-3 py-2 transition duration-200 ease-in-out
                       {{ $active ? 'bg-brand-50 text-brand-700 font-semibold border-l-4 border-brand-500 -ml-1 pl-4' : 'text-slate-600 hover:bg-slate-50' }}"
                @click="sidebarOpen = false"
              >
                <span class="h-1.5 w-1.5 rounded-full {{ $active ? 'bg-brand-500' : 'bg-slate-300 group-hover:bg-brand-500' }}"></span>
                <span>{{ $item['label'] }}</span>
              </a>
            @endforeach
          </nav>

          <div class="px-4 py-4 border-t border-slate-100">
            <div class="flex items-center justify-between gap-3">
              <div class="text-xs text-slate-500">
                <div class="font-semibold text-slate-700">
                  {{ auth()->user()->name }}
                </div>
                @if(auth()->user()->email)
                  <div class="text-[11px] text-slate-400">
                    {{ auth()->user()->email }}
                  </div>
                @endif
              </div>
              <form method="POST" action="{{ route('logout') }}">
                @csrf
                <button class="btn-ghost text-xs" type="submit">Logout</button>
              </form>
            </div>
          </div>
        </aside>
      </div>

      <!-- Main area -->
      <div class="flex-1 min-w-0 flex flex-col min-h-0">
        <header class="no-print sticky top-0 z-10 h-16 bg-white border-b border-slate-100 flex items-center justify-between px-4 sm:px-6 lg:px-8 shrink-0">
          <div class="flex items-center gap-3">
            <button class="lg:hidden btn-ghost text-xs" @click="sidebarOpen = true" type="button">Menu</button>
            <div>
              <div class="text-sm font-semibold text-slate-900 tracking-tight">@yield('title')</div>
              <div class="text-xs text-slate-500">@yield('subtitle')</div>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <div class="hidden sm:flex flex-col items-end text-xs text-slate-500">
              <div class="font-semibold text-slate-800">{{ auth()->user()->name }}</div>
              @if(auth()->user()->email)
                <div class="text-[11px] text-slate-400">{{ auth()->user()->email }}</div>
              @endif
            </div>
            <div class="h-9 w-9 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-semibold">
              {{ strtoupper(mb_substr(auth()->user()->name ?? 'A', 0, 1)) }}
            </div>
          </div>
        </header>

        <main class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
          <div class="animate-[fadeUp_220ms_ease-in-out]">
            @yield('content')
          </div>
        </main>

        <!-- Toast Notifications Container -->
        <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-3 pointer-events-none max-w-sm">
          @if(session('success'))
            <div class="toast toast-success card border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3 flex items-center justify-between gap-3 animate-toast-in shadow-lg pointer-events-auto" role="alert">
              <div class="flex-1">{{ session('success') }}</div>
              <button onclick="this.parentElement.remove()" class="text-emerald-600 hover:text-emerald-800 flex-shrink-0 font-bold">✕</button>
            </div>
          @endif

          @if(session('error'))
            <div class="toast toast-error card border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex items-center justify-between gap-3 animate-toast-in shadow-lg pointer-events-auto" role="alert">
              <div class="flex-1">{{ session('error') }}</div>
              <button onclick="this.parentElement.remove()" class="text-rose-600 hover:text-rose-800 flex-shrink-0 font-bold">✕</button>
            </div>
          @endif

          @if($errors->any())
            <div class="card border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-3 animate-toast-in shadow-lg pointer-events-auto" role="alert">
              <div class="font-semibold mb-1">Please fix the highlighted fields</div>
              <ul class="list-disc ml-5 text-xs">
                @foreach($errors->all() as $err)
                  <li>{{ $err }}</li>
                @endforeach
              </ul>
            </div>
          @endif
        </div>
      </div>
    </div>

    <script>
      function searchWidget() {
        return {
          q: '',
          open: false,
          suggestions: { invoices: [], customers: [] },
          async fetch() {
            if (this.q.length < 2) { this.suggestions = { invoices: [], customers: [] }; return; }
            const r = await fetch('/api/search?q=' + encodeURIComponent(this.q));
            this.suggestions = await r.json();
          }
        };
      }

      // Auto-dismiss toasts after 5 seconds
      document.addEventListener('DOMContentLoaded', function() {
        const toasts = document.querySelectorAll('.toast');
        toasts.forEach(toast => {
          setTimeout(() => {
            toast.style.animation = 'toastOut 0.4s ease-out forwards';
            setTimeout(() => {
              toast.remove();
            }, 400);
          }, 5000);
        });
      });
    </script>
    <style>
      [x-cloak] { display: none !important; }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes toastSlide { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes toastIn { from { opacity: 0; transform: translateX(400px) translateY(400px); } to { opacity: 1; transform: translateX(0) translateY(0); } }
      @keyframes toastOut { from { opacity: 1; transform: translateX(0) translateY(0); } to { opacity: 0; transform: translateX(400px) translateY(400px); } }
      .animate-toast { animation: toastSlide 0.3s ease-out; }
      .animate-toast-in { animation: toastIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
      @media print { .no-print { display: none !important; } }
    </style>
  </body>
</html>

