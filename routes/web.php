<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\CustomerController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\InvoiceController;
use App\Http\Controllers\PackageController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\ServiceController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    if (!auth()->check()) {
        return redirect()->route('login');
    }
    
    $user = auth()->user();
    
    // Admin gets dashboard
    if ($user->isAdmin()) {
        return redirect()->route('dashboard');
    }
    
    // Check permissions and redirect to first accessible page
    if ($user->canAccess('dashboard', 'view')) {
        return redirect()->route('dashboard');
    } elseif ($user->canAccess('invoices', 'view')) {
        return redirect()->route('invoices.index');
    } elseif ($user->canAccess('payments', 'view')) {
        return redirect()->route('payments.index');
    } elseif ($user->canAccess('customers', 'view')) {
        return redirect()->route('customers.index');
    } elseif ($user->canAccess('services', 'view')) {
        return redirect()->route('services.index');
    } elseif ($user->canAccess('reports', 'view')) {
        return redirect()->route('reports.customers');
    } else {
        // No access anywhere, logout
        auth()->logout();
        return redirect()->route('login')->with('error', 'You do not have access to any section.');
    }
});

Route::middleware('guest')->group(function () {
    Route::get('/login', [LoginController::class, 'showLoginForm'])->name('login');
    Route::post('/login', [LoginController::class, 'login'])->name('login.attempt')->middleware('throttle:5,1');
});

Route::post('/logout', [LoginController::class, 'logout'])->middleware('auth')->name('logout');

Route::middleware('auth')->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index'])->middleware('permission:dashboard,view')->name('dashboard');
    Route::get('/dashboard/export-pdf', [DashboardController::class, 'exportPdf'])->middleware('permission:dashboard,view')->name('dashboard.export-pdf');

    Route::get('/customers', [CustomerController::class, 'index'])->middleware('permission:customers,view')->name('customers.index');
    Route::post('/customers', [CustomerController::class, 'store'])->middleware('permission:customers,create')->name('customers.store');
    Route::put('/customers/{customer}', [CustomerController::class, 'update'])->middleware('permission:customers,edit')->name('customers.update');
    Route::delete('/customers/{customer}', [CustomerController::class, 'destroy'])->middleware('permission:customers,delete')->name('customers.destroy');

    Route::get('/services', [ServiceController::class, 'index'])->middleware('permission:services,view')->name('services.index');
    Route::post('/services', [ServiceController::class, 'store'])->middleware('permission:services,create')->name('services.store');
    Route::put('/services/{service}', [ServiceController::class, 'update'])->middleware('permission:services,edit')->name('services.update');
    Route::delete('/services/{service}', [ServiceController::class, 'destroy'])->middleware('permission:services,delete')->name('services.destroy');

    Route::get('/packages', [PackageController::class, 'index'])->middleware('permission:services,view')->name('packages.index');
    Route::get('/packages/create', [PackageController::class, 'create'])->middleware('permission:services,create')->name('packages.create');
    Route::post('/packages', [PackageController::class, 'store'])->middleware('permission:services,create')->name('packages.store');
    Route::get('/packages/{package}/edit', [PackageController::class, 'edit'])->middleware('permission:services,edit')->name('packages.edit');
    Route::put('/packages/{package}', [PackageController::class, 'update'])->middleware('permission:services,edit')->name('packages.update');
    Route::delete('/packages/{package}', [PackageController::class, 'destroy'])->middleware('permission:services,delete')->name('packages.destroy');

    Route::get('/invoices', [InvoiceController::class, 'index'])->middleware('permission:invoices,view')->name('invoices.index');
    Route::post('/invoices/bulk-approve', [InvoiceController::class, 'bulkApprove'])->middleware('permission:invoices,approve')->name('invoices.bulk-approve');
    Route::post('/invoices/bulk-delete', [InvoiceController::class, 'bulkDelete'])->middleware('permission:invoices,delete')->name('invoices.bulk-delete');
    Route::get('/invoices/create', [InvoiceController::class, 'create'])->middleware('permission:invoices,create')->name('invoices.create');
    Route::post('/invoices', [InvoiceController::class, 'store'])->middleware('permission:invoices,create')->name('invoices.store');
    Route::get('/invoices/{invoice}/edit', [InvoiceController::class, 'edit'])->middleware('permission:invoices,edit')->name('invoices.edit');
    Route::put('/invoices/{invoice}', [InvoiceController::class, 'update'])->middleware('permission:invoices,edit')->name('invoices.update');
    Route::get('/invoices/{invoice}', [InvoiceController::class, 'show'])->middleware('permission:invoices,view')->name('invoices.show');
    Route::delete('/invoices/{invoice}', [InvoiceController::class, 'destroy'])->middleware('permission:invoices,delete')->name('invoices.destroy');
    Route::post('/invoices/{invoice}/send-email', [InvoiceController::class, 'sendEmail'])->middleware('permission:invoices,view')->name('invoices.send-email');
    Route::get('/invoices/{invoice}/pdf', [InvoiceController::class, 'pdf'])->middleware('permission:invoices,view')->name('invoices.pdf');
    Route::post('/invoices/{invoice}/approve', [InvoiceController::class, 'approve'])->middleware('permission:invoices,approve')->name('invoices.approve');
    Route::post('/invoices/{invoice}/withdraw', [InvoiceController::class, 'withdraw'])->middleware('permission:invoices,withdraw')->name('invoices.withdraw');

    Route::get('/api/search', [\App\Http\Controllers\SearchController::class, 'index'])->name('api.search');

    Route::get('/reports/customers', [ReportController::class, 'customerReports'])->middleware('permission:reports,view')->name('reports.customers');
    Route::get('/reports/customers/export-pdf', [ReportController::class, 'exportPdf'])->middleware('permission:reports,view')->name('reports.export-pdf');
    Route::get('/reports/customers/export-excel', [ReportController::class, 'exportExcel'])->middleware('permission:reports,view')->name('reports.export-excel');

    Route::get('/payments', [PaymentController::class, 'index'])->middleware('permission:payments,view')->name('payments.index');
    Route::get('/payments/create', [PaymentController::class, 'create'])->middleware('permission:payments,create')->name('payments.create');
    Route::post('/payments', [PaymentController::class, 'store'])->middleware('permission:payments,create')->name('payments.store');
    Route::delete('/payments/{payment}', [PaymentController::class, 'destroy'])->middleware('permission:payments,delete')->name('payments.destroy');
    Route::get('/payments/{payment}/receipt', [PaymentController::class, 'receipt'])->middleware('permission:payments,view')->name('payments.receipt');
    Route::post('/payments/advance', [PaymentController::class, 'storeAdvance'])->middleware('permission:payments,create')->name('payments.advance.store');
    Route::post('/invoices/{invoice}/apply-advance', [PaymentController::class, 'applyAdvance'])->middleware('permission:payments,create')->name('payments.apply-advance');


    Route::get('/settings/company', [SettingsController::class, 'company'])->middleware('permission:settings,view')->name('settings.company');
    Route::post('/settings/company', [SettingsController::class, 'updateCompany'])->middleware('permission:settings,edit')->name('settings.company.update');
    Route::get('/settings/tax', [SettingsController::class, 'tax'])->middleware('permission:settings,view')->name('settings.tax');
    Route::post('/settings/tax', [SettingsController::class, 'updateTax'])->middleware('permission:settings,edit')->name('settings.tax.update');
    Route::get('/settings/invoice-template', [SettingsController::class, 'invoiceTemplate'])->middleware('permission:settings,view')->name('settings.invoice_template');
    Route::post('/settings/invoice-template', [SettingsController::class, 'updateInvoiceTemplate'])->middleware('permission:settings,edit')->name('settings.invoice_template.update');
    Route::get('/settings/numbering', [SettingsController::class, 'numbering'])->middleware('permission:settings,view')->name('settings.numbering');
    Route::post('/settings/numbering', [SettingsController::class, 'updateNumbering'])->middleware('permission:settings,edit')->name('settings.numbering.update');
    Route::middleware('permission:users,view')->group(function () {
        Route::get('/settings/users', [UserController::class, 'index'])->name('settings.users');
        Route::get('/settings/users/{user}/edit', [UserController::class, 'edit'])->name('settings.users.edit');
    });
    Route::middleware('permission:users,create')->group(function () {
        Route::post('/settings/users', [UserController::class, 'store'])->name('settings.users.store');
    });
    Route::middleware('permission:users,edit')->group(function () {
        Route::put('/settings/users/{user}', [UserController::class, 'update'])->name('settings.users.update');
    });
    Route::middleware('permission:users,delete')->group(function () {
        Route::delete('/settings/users/{user}', [UserController::class, 'destroy'])->name('settings.users.destroy');
    });
    Route::post('/settings/roles', [RoleController::class, 'store'])->name('settings.roles.store')->middleware('permission:users,create');
    Route::middleware('permission:users,edit')->group(function () {
        Route::get('/settings/roles/{role}/edit', [RoleController::class, 'edit'])->name('settings.roles.edit');
        Route::put('/settings/roles/{role}', [RoleController::class, 'update'])->name('settings.roles.update');
    });
    Route::middleware('permission:users,delete')->group(function () {
        Route::delete('/settings/roles/{role}', [RoleController::class, 'destroy'])->name('settings.roles.destroy');
    });
});
