<?php

namespace App\Http\Controllers;

use App\Models\CompanySetting;
use App\Models\InvoiceNumberSetting;
use App\Models\InvoiceTemplateSetting;
use App\Models\PaymentNumberSetting;
use App\Models\TaxSetting;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\View\View;

class SettingsController extends Controller
{
    public function company(): View
    {
        $company = CompanySetting::first() ?? new CompanySetting;
        return view('settings.company', compact('company'));
    }

    public function updateCompany(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'company_name' => ['required', 'string', 'max:255'],
            'email' => ['nullable', 'email'],
            'phone' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string'],
            'trn_number' => ['nullable', 'string', 'max:50'],
            'revenue_target' => ['nullable', 'numeric', 'min:0'],
            'logo' => ['nullable', 'image', 'mimes:png,jpg,jpeg,webp', 'max:1024'],
        ]);

        $company = CompanySetting::first() ?? new CompanySetting(['id' => 1]);
        $company->fill($validated);

        if ($request->hasFile('logo')) {
            if ($company->logo_path) {
                Storage::disk('public')->delete($company->logo_path);
            }
            $company->logo_path = $request->file('logo')->store('company-logos', 'public');
        }

        $company->save();
        return back()->with('success', 'Company profile updated.');
    }

    public function tax(): View
    {
        $tax = TaxSetting::first() ?? new TaxSetting(['vat_percentage' => 5, 'vat_enabled' => true]);
        return view('settings.tax', compact('tax'));
    }

    public function updateTax(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'vat_percentage' => ['required', 'numeric', 'min:0', 'max:100'],
            'vat_enabled' => ['boolean'],
        ]);
        $validated['vat_enabled'] = $request->boolean('vat_enabled');
        TaxSetting::updateOrCreate(['id' => 1], $validated);
        return back()->with('success', 'Tax settings updated.');
    }

    public function invoiceTemplate(): View
    {
        $template = InvoiceTemplateSetting::first() ?? new InvoiceTemplateSetting;
        return view('settings.invoice-template', compact('template'));
    }

    public function updateInvoiceTemplate(Request $request): RedirectResponse
    {
        $template = InvoiceTemplateSetting::first() ?? new InvoiceTemplateSetting;
        if ($request->hasFile('header_image')) {
            if ($template->header_image_path) {
                Storage::disk('public')->delete($template->header_image_path);
            }
            $template->header_image_path = $request->file('header_image')->store('invoice-templates', 'public');
        }
        if ($request->hasFile('footer_image')) {
            if ($template->footer_image_path) {
                Storage::disk('public')->delete($template->footer_image_path);
            }
            $template->footer_image_path = $request->file('footer_image')->store('invoice-templates', 'public');
        }
        $template->save();
        return back()->with('success', 'Invoice template updated.');
    }

    public function numbering(): View
    {
        $invoiceNumbering = InvoiceNumberSetting::first() ?? new InvoiceNumberSetting(['prefix' => 'INV', 'next_number' => 1, 'padding' => 5]);
        $paymentNumbering = PaymentNumberSetting::first() ?? new PaymentNumberSetting(['prefix' => 'PAY', 'next_number' => 1, 'padding' => 5]);
        return view('settings.numbering', compact('invoiceNumbering', 'paymentNumbering'));
    }

    public function updateNumbering(Request $request): RedirectResponse
    {
        $request->validate([
            'invoice_prefix' => ['required', 'string', 'max:20'],
            'invoice_next_number' => ['required', 'integer', 'min:1'],
            'invoice_padding' => ['required', 'integer', 'min:1', 'max:10'],
            'payment_prefix' => ['required', 'string', 'max:20'],
            'payment_next_number' => ['required', 'integer', 'min:1'],
            'payment_padding' => ['required', 'integer', 'min:1', 'max:10'],
        ]);
        InvoiceNumberSetting::updateOrCreate(['id' => 1], [
            'prefix' => $request->invoice_prefix,
            'next_number' => $request->invoice_next_number,
            'padding' => $request->invoice_padding,
        ]);
        PaymentNumberSetting::updateOrCreate(['id' => 1], [
            'prefix' => $request->payment_prefix,
            'next_number' => $request->payment_next_number,
            'padding' => $request->payment_padding,
        ]);
        return back()->with('success', 'Numbering settings updated.');
    }
}
