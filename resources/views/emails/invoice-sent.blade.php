<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: sans-serif; color: #334155; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .card { background: #f8fafc; border-radius: 12px; padding: 24px; margin: 20px 0; }
        .btn { display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Your Invoice</h1>
        <p>Dear {{ $invoice->customer->name }},</p>
        <p>Please find attached invoice <strong>{{ $invoice->invoice_number }}</strong> for {{ number_format($invoice->grand_total, 2) }} AED.</p>
        <div class="card">
            <p>Invoice No: <strong>{{ $invoice->invoice_number }}</strong></p>
            <p>Date: {{ $invoice->invoice_date?->format('d M Y') }}</p>
            <p>Total: <strong>{{ number_format($invoice->grand_total, 2) }} AED</strong></p>
            <a href="{{ url('/invoices/' . $invoice->id) }}" class="btn">View Invoice Online</a>
        </div>
        <p>If you have any questions, please contact us.</p>
    </div>
</body>
</html>
