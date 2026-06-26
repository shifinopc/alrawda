<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class SearchController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = $request->input('q', '');
        if (strlen($q) < 2) {
            return response()->json(['invoices' => [], 'customers' => []]);
        }
        $invoices = Invoice::with('customer')
            ->where(function ($query) use ($q) {
                $query->where('invoice_number', 'like', "%{$q}%")
                    ->orWhereHas('customer', fn ($c) => $c->where('name', 'like', "%{$q}%"));
            })
            ->limit(8)
            ->get(['id', 'invoice_number', 'customer_id'])
            ->map(fn ($i) => [
                'id' => $i->id,
                'text' => $i->invoice_number . ' – ' . $i->customer->name,
                'url' => route('invoices.show', $i),
            ]);
        $customers = Customer::where('name', 'like', "%{$q}%")
            ->limit(5)
            ->get(['id', 'name'])
            ->map(fn ($c) => [
                'id' => $c->id,
                'text' => $c->name,
                'url' => route('invoices.index', ['search' => $c->name]),
            ]);
        return response()->json(['invoices' => $invoices, 'customers' => $customers]);
    }
}
