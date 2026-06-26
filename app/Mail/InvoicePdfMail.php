<?php

namespace App\Mail;

use App\Models\Invoice;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class InvoicePdfMail extends Mailable
{
    use Queueable, SerializesModels;

    public static function sendTo(Invoice $invoice, string $email): void
    {
        \Illuminate\Support\Facades\Mail::to($email)->send(new self($invoice));
    }

    public function __construct(public Invoice $invoice)
    {
        $this->invoice->load(['customer', 'items.service']);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Invoice ' . $this->invoice->invoice_number . ' from ' . (\App\Models\CompanySetting::first()?->company_name ?? config('app.name')),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.invoice-sent',
        );
    }

    public function attachments(): array
    {
        $company = \App\Models\CompanySetting::first();
        $template = \App\Models\InvoiceTemplateSetting::first();
        $preparedBy = auth()->user()?->name ?? 'Admin';
        $pdf = Pdf::loadView('invoices.pdf', [
            'invoice' => $this->invoice,
            'company' => $company,
            'template' => $template,
            'preparedBy' => $preparedBy,
        ]);
        $pdfContent = $pdf->output();
        return [
            Attachment::fromData(fn () => $pdfContent, "invoice-{$this->invoice->invoice_number}.pdf")
                ->withMime('application/pdf'),
        ];
    }
}
