@extends('layouts.auth')

@section('content')
  <div class="min-h-screen flex">
    <!-- Left: Login form -->
    <div class="flex-1 flex items-center justify-center px-6 py-12 lg:px-12 bg-white">
      <div class="w-full max-w-md">
        @php
          $company = \App\Models\CompanySetting::first();
          $loginLogo = $company?->logo_path ? asset('storage/'.$company->logo_path) : null;
        @endphp
        <div class="mb-10 flex justify-center">
          @if($loginLogo)
            <img src="{{ $loginLogo }}" alt="{{ $company?->company_name ?? config('app.name') }}" class="h-20 w-auto max-w-[200px] object-contain" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="h-12 flex items-center justify-center rounded-lg bg-slate-100 px-4 text-lg font-bold text-slate-700" style="display:none;">
              {{ $company?->company_name ?? config('app.name') }}
            </div>
          @else
            <div class="h-12 flex items-center rounded-lg bg-slate-100 px-4 text-lg font-bold text-slate-700">
              {{ $company?->company_name ?? config('app.name') }}
            </div>
          @endif
        </div>

        <h1 class="text-3xl font-bold tracking-tight text-slate-900">Welcome Back</h1>
        <p class="mt-2 text-slate-600">Enter your email and password to access your account.</p>

        <form method="POST" action="{{ route('login.attempt') }}" class="mt-8 space-y-5">
          @csrf
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Email</label>
            <input name="email" type="email" value="{{ old('email') }}"
                   class="input w-full" placeholder="example@mail.com" required autofocus>
            @error('email')
              <p class="mt-1 text-sm text-rose-600">{{ $message }}</p>
            @enderror
          </div>

          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Password</label>
            <div class="relative">
              <input name="password" type="password" id="password" class="input w-full pr-10" placeholder="••••••••" required>
              <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onclick="const e=document.getElementById('password');e.type=e.type==='password'?'text':'password'">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              </button>
            </div>
            @error('password')
              <p class="mt-1 text-sm text-rose-600">{{ $message }}</p>
            @enderror
          </div>

          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" name="remember" class="rounded border-slate-300 text-brand-600 focus:ring-brand-500">
              Remember me
            </label>
            <a href="#" class="text-sm font-semibold text-brand-600 hover:text-brand-700">Forgot Password?</a>
          </div>

          <button class="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold hover:from-brand-600 hover:to-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition shadow-lg" type="submit">
            Log In
          </button>
        </form>

      </div>
    </div>

    <!-- Right: Promotional panel -->
    <div class="hidden lg:flex flex-1 bg-gradient-to-br from-brand-600 to-brand-800 relative overflow-hidden">
      <div class="absolute inset-0 opacity-10">
        <div class="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-white blur-3xl -translate-x-1/2 translate-y-1/2"></div>
        <div class="absolute top-1/4 right-1/4 w-64 h-64 rounded-full bg-white blur-2xl"></div>
      </div>
      
      <!-- Animated SVG Illustration -->
      <div class="absolute inset-0 flex items-center justify-end pr-12">
        <svg width="300" height="300" viewBox="0 0 300 300" class="opacity-20" style="animation: float 6s ease-in-out infinite;">
          <!-- Floating document animation -->
          <g id="invoice-doc">
            <rect x="30" y="40" width="120" height="160" rx="8" fill="white" stroke="white" stroke-width="2"/>
            <line x1="50" y1="70" x2="130" y2="70" stroke="currentColor" stroke-width="2"/>
            <line x1="50" y1="90" x2="130" y2="90" stroke="currentColor" stroke-width="2"/>
            <line x1="50" y1="110" x2="100" y2="110" stroke="currentColor" stroke-width="2"/>
            <circle cx="140" cy="170" r="12" fill="white" stroke="white" stroke-width="2"/>
          </g>
          
          <!-- Animated checkmark -->
          <g id="checkmark" style="animation: popIn 1.5s ease-in-out infinite 0.3s;">
            <circle cx="220" cy="100" r="35" fill="white" opacity="0.2"/>
            <path d="M205 100 L215 110 L235 90" stroke="white" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </g>
          
          <!-- Animated coins -->
          <g id="coin-1" style="animation: bounce 2s ease-in-out infinite;">
            <circle cx="60" cy="230" r="15" fill="white" opacity="0.3"/>
            <text x="60" y="238" text-anchor="middle" font-size="20" fill="white" opacity="0.6">💰</text>
          </g>
          
          <g id="coin-2" style="animation: bounce 2s ease-in-out infinite 0.4s;">
            <circle cx="130" cy="250" r="12" fill="white" opacity="0.2"/>
            <text x="130" y="256" text-anchor="middle" font-size="16" fill="white" opacity="0.5">💳</text>
          </g>
        </svg>
      </div>

      <style>
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(2deg); }
        }
        @keyframes popIn {
          0%, 100% { transform: scale(0.8); opacity: 0; }
          50% { transform: scale(1); opacity: 1; }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0px); opacity: 0.3; }
          50% { transform: translateY(-30px); opacity: 0.8; }
        }
      </style>

      <div class="relative z-10 flex flex-col justify-center px-12 xl:px-20 py-16">
        <h2 class="text-3xl xl:text-4xl font-bold text-white leading-tight">
          Effortlessly manage your invoices and payments.
        </h2>
        <p class="mt-4 text-lg text-brand-100">
          Log in to access your billing dashboard, manage customers, and track VAT-compliant invoices.
        </p>
        <div class="mt-12 p-6 bg-white/10 backdrop-blur rounded-2xl border border-white/20 max-w-lg">
          <div class="grid grid-cols-2 gap-4 text-white">
            <div>
              <div class="text-xs font-semibold text-brand-200">Total Revenue</div>
              <div class="text-2xl font-bold">AED —</div>
            </div>
            <div>
              <div class="text-xs font-semibold text-brand-200">Invoices</div>
              <div class="text-2xl font-bold">—</div>
            </div>
            <div class="col-span-2">
              <div class="text-xs font-semibold text-brand-200 mb-2">Recent Activity</div>
              <div class="h-24 bg-white/5 rounded-lg flex items-center justify-center text-brand-200 text-sm">
                Dashboard preview
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
@endsection
