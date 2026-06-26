<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class CustomerController extends Controller
{
    public function index(Request $request): View
    {
        $query = Customer::query();
        if ($request->filled('search')) {
            $q = $request->search;
            $query->where(function ($qry) use ($q) {
                $qry->where('name', 'like', "%{$q}%")
                    ->orWhere('customer_ref', 'like', "%{$q}%")
                    ->orWhere('phone', 'like', "%{$q}%")
                    ->orWhere('trn_number', 'like', "%{$q}%");
            });
        }
        $customers = $query->latest()->paginate(10)->withQueryString();
        return view('customers.index', compact('customers'));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'customer_ref' => ['nullable', 'string', 'max:100'],
            'trn_number' => ['nullable', 'string', 'max:50'],
            'phone' => ['nullable', 'string', 'max:50'],
            'alternate_number' => ['nullable', 'string', 'max:50'],
        ]);
        $customer = Customer::create($validated);
        return response()->json(['success' => true, 'customer' => $customer]);
    }

    public function update(Request $request, Customer $customer): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'customer_ref' => ['nullable', 'string', 'max:100'],
            'trn_number' => ['nullable', 'string', 'max:50'],
            'phone' => ['nullable', 'string', 'max:50'],
            'alternate_number' => ['nullable', 'string', 'max:50'],
        ]);
        $customer->update($validated);
        return response()->json(['success' => true, 'customer' => $customer->fresh()]);
    }

    public function destroy(Customer $customer): JsonResponse
    {
        if ($customer->invoices()->exists()) {
            return response()->json(['success' => false, 'message' => 'Cannot delete customer with existing invoices.'], 422);
        }
        $customer->delete();
        return response()->json(['success' => true]);
    }
}
