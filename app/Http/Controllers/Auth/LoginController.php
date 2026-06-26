<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

class LoginController extends Controller
{
    public function showLoginForm(): View
    {
        return view('auth.login');
    }

    public function login(Request $request): RedirectResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required'],
        ]);

        if (Auth::attempt($credentials, $request->boolean('remember'))) {
            $request->session()->regenerate();
            
            // Redirect to first accessible page based on user permissions
            $user = Auth::user();
            
            // Admin gets dashboard
            if ($user->isAdmin()) {
                return redirect()->intended(route('dashboard'));
            }
            
            // Check permissions and redirect to first accessible page
            if ($user->canAccess('dashboard', 'view')) {
                return redirect()->intended(route('dashboard'));
            } elseif ($user->canAccess('invoices', 'view')) {
                return redirect()->intended(route('invoices.index'));
            } elseif ($user->canAccess('payments', 'view')) {
                return redirect()->intended(route('payments.index'));
            } elseif ($user->canAccess('customers', 'view')) {
                return redirect()->intended(route('customers.index'));
            } elseif ($user->canAccess('services', 'view')) {
                return redirect()->intended(route('services.index'));
            } elseif ($user->canAccess('reports', 'view')) {
                return redirect()->intended(route('reports.customers'));
            } else {
                // No permissions, show error page
                Auth::logout();
                return back()->withErrors([
                    'email' => 'You do not have access to any section of this application.',
                ])->onlyInput('email');
            }
        }

        return back()->withErrors([
            'email' => __('The provided credentials do not match our records.'),
        ])->onlyInput('email');
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        return redirect()->route('login');
    }
}
