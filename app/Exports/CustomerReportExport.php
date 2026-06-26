<?php

namespace App\Exports;

use App\Models\Customer;
use Illuminate\Support\Collection;
use Maatwebsite\Excel\Concerns\FromCollection;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithTitle;

class CustomerReportExport implements FromCollection, WithHeadings, WithTitle
{
    public function __construct(
        public Customer $customer,
        public Collection $invoices,
        public array $summary,
    ) {}

    public function collection(): Collection
    {
        $rows = collect();
        foreach ($this->invoices as $inv) {
            $rows->push([
                $inv->invoice_number,
                $inv->invoice_date?->format('d M Y'),
                $inv->items->count(),
                number_format((float) $inv->subtotal_taxable, 2),
                number_format((float) $inv->subtotal_non_taxable, 2),
                number_format((float) $inv->vat_amount, 2),
                number_format((float) $inv->grand_total, 2),
                ucfirst(str_replace('_', ' ', $inv->status)),
            ]);
        }
        return $rows;
    }

    public function headings(): array
    {
        return ['Invoice', 'Date', 'Services', 'Taxable', 'Non-Taxable', 'VAT', 'Total', 'Status'];
    }

    public function title(): string
    {
        return 'Invoice Breakdown';
    }
}
