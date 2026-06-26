<?php

namespace App\Http\Controllers;

use App\Models\Service;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class ServiceController extends Controller
{
    public function index(Request $request): View
    {
        $query = Service::query()->latest();
        if ($request->filled('search')) {
            $q = $request->search;
            $query->where(function ($qr) use ($q) {
                $qr->where('name', 'like', "%{$q}%")
                   ->orWhere('description', 'like', "%{$q}%");
            });
        }
        $services = $query->paginate(10)->withQueryString();
        return view('services.index', compact('services'));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'taxable_amount' => ['required', 'numeric', 'min:0'],
            'non_taxable_amount' => ['required', 'numeric', 'min:0'],
        ]);
        $service = Service::create($validated);
        return response()->json(['success' => true, 'service' => $service]);
    }

    public function update(Request $request, Service $service): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'taxable_amount' => ['required', 'numeric', 'min:0'],
            'non_taxable_amount' => ['required', 'numeric', 'min:0'],
        ]);
        $service->update($validated);
        return response()->json(['success' => true, 'service' => $service->fresh()]);
    }

    public function destroy(Service $service): JsonResponse
    {
        if ($service->invoiceItems()->exists()) {
            return response()->json(['success' => false, 'message' => 'Cannot delete service used in invoices.'], 422);
        }
        $service->delete();
        return response()->json(['success' => true]);
    }
}
