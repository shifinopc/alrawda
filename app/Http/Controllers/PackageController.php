<?php

namespace App\Http\Controllers;

use App\Models\Package;
use App\Models\PackageItem;
use App\Models\Service;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class PackageController extends Controller
{
    public function index(Request $request): View
    {
        $query = Package::query()->with('items.service')->latest();
        if ($request->filled('search')) {
            $q = $request->search;
            $query->where(function ($qr) use ($q) {
                $qr->where('name', 'like', "%{$q}%")
                   ->orWhere('description', 'like', "%{$q}%");
            });
        }
        $packages = $query->paginate(10)->withQueryString();
        return view('packages.index', compact('packages'));
    }

    public function create(): View
    {
        $services = Service::orderBy('name')->get();
        return view('packages.create', compact('services'));
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'discount_type' => ['nullable', 'in:percentage,fixed'],
            'discount_value' => ['nullable', 'numeric', 'min:0'],
            'rounding_rule' => ['nullable', 'in:nearest_5,nearest_10,nearest_50,custom'],
            'rounding_target' => ['nullable', 'numeric', 'min:0'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.service_id' => ['required', 'exists:services,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'items.*.taxable_amount' => ['nullable', 'numeric', 'min:0'],
            'items.*.non_taxable_amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $package = Package::create([
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'discount_type' => $validated['discount_type'] ?: null,
            'discount_value' => $validated['discount_value'] ?? null,
            'rounding_rule' => $validated['rounding_rule'] ?? null,
            'rounding_target' => $validated['rounding_target'] ?? null,
        ]);

        foreach ($validated['items'] as $item) {
            $package->items()->create([
                'service_id' => $item['service_id'],
                'quantity' => (int) $item['quantity'],
                'taxable_amount' => isset($item['taxable_amount']) && $item['taxable_amount'] !== '' ? $item['taxable_amount'] : null,
                'non_taxable_amount' => isset($item['non_taxable_amount']) && $item['non_taxable_amount'] !== '' ? $item['non_taxable_amount'] : null,
            ]);
        }

        return redirect()->route('packages.index')->with('success', 'Package created successfully.');
    }

    public function edit(Package $package): View
    {
        $package->load('items.service');
        $services = Service::orderBy('name')->get();
        return view('packages.edit', compact('package', 'services'));
    }

    public function update(Request $request, Package $package): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'discount_type' => ['nullable', 'in:percentage,fixed'],
            'discount_value' => ['nullable', 'numeric', 'min:0'],
            'rounding_rule' => ['nullable', 'in:nearest_5,nearest_10,nearest_50,custom'],
            'rounding_target' => ['nullable', 'numeric', 'min:0'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.service_id' => ['required', 'exists:services,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'items.*.taxable_amount' => ['nullable', 'numeric', 'min:0'],
            'items.*.non_taxable_amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $package->update([
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'discount_type' => $validated['discount_type'] ?: null,
            'discount_value' => $validated['discount_value'] ?? null,
            'rounding_rule' => $validated['rounding_rule'] ?? null,
            'rounding_target' => $validated['rounding_target'] ?? null,
        ]);

        $package->items()->delete();
        foreach ($validated['items'] as $item) {
            $package->items()->create([
                'service_id' => $item['service_id'],
                'quantity' => (int) $item['quantity'],
                'taxable_amount' => isset($item['taxable_amount']) && $item['taxable_amount'] !== '' ? $item['taxable_amount'] : null,
                'non_taxable_amount' => isset($item['non_taxable_amount']) && $item['non_taxable_amount'] !== '' ? $item['non_taxable_amount'] : null,
            ]);
        }

        return redirect()->route('packages.index')->with('success', 'Package updated successfully.');
    }

    public function destroy(Package $package): RedirectResponse
    {
        if ($package->invoiceItems()->exists()) {
            return back()->with('error', 'Cannot delete package used in invoices.');
        }
        $package->items()->delete();
        $package->delete();
        return redirect()->route('packages.index')->with('success', 'Package deleted.');
    }
}
