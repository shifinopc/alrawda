<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      @page { margin: 10mm 8mm; }
      /* Match application font stack and ensure pure black text for printing */
      body {
        font-family: "Bricolage Grotesque", DejaVu Sans, sans-serif;
        color: #000000;
        font-size: 14px;
      }
      .muted { color: #000000; }
      .h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
      .row { width: 100%; }
      .col { display: inline-block; vertical-align: top; }
      .w-50 { width: 49%; }
      .mt-8 { margin-top: 8px; }
      .mt-12 { margin-top: 12px; }
      .mt-16 { margin-top: 16px; }
      .box { border: 1px solid #000; border-radius: 0; padding: 8px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #000; }
      th { text-align: center; font-size: 12px; color: #000000; padding: 6px 4px; }
      td { padding: 6px 4px; font-size: 12px; color: #000000; }
      .text-right { text-align: right; }
      .total-row td { border-bottom: none; }
      .strong { font-weight: 700; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid #334155; font-size: 11px; color: #334155; }
      .header-img { width: 100%; max-height: 230px; object-fit: cover; }
      .footer-img { width: 100%; max-height: 200px; object-fit: cover; }
      .footer { position: fixed; bottom: -10mm; left: 0; right: 0; }
    </style>

  </head>
  <body>
    @if($template && $template->header_image_path)
      <img class="header-img" src="{{ public_path('storage/'.$template->header_image_path) }}" alt="Header">
    @endif

    <div class="row mt-16" style="text-align:center;">
      <div style="width:100%;">
        <p class="h1">PAYMENT RECEIPT</p>
      </div>
    </div>

    <!-- Payment / customer info block -->
    <div class="row mt-12">
      <table>
        <tr>
          <td style="width:50%; vertical-align:top; padding:10px;">
            <div class="strong">TRN</div>
            <div class="muted">{{ $company?->trn_number ?? '—' }}</div>
            @if($payment->payment_number)
              <div class="strong">Receipt / Payment No</div>
              <div class="muted">{{ $payment->payment_number }}</div>
            @endif
            <div class="mt-8 strong">Receipt Date</div>
            <div class="muted">{{ $payment->payment_date?->format('d-M-Y') }}</div>
            @if($payment->invoice)
              <div class="mt-8 strong">Invoice No</div>
              <div class="muted">{{ $payment->invoice->invoice_number }}</div>
            @endif
            @if($payment->reference)
              <div class="mt-8 strong">Reference</div>
              <div class="muted">{{ $payment->reference }}</div>
            @endif
          </td>
          <td style="width:50%; vertical-align:top; padding:10px;">
            <div class="strong">Customer Name</div>
            <div class="muted">{{ $customer->name }}</div>
            @if($customer->customer_ref)
              <div class="mt-8 strong">Customer Ref.</div>
              <div class="muted">{{ $customer->customer_ref }}</div>
            @endif
            @if($customer->phone)
              <div class="mt-8 strong">Mobile No.</div>
              <div class="muted">{{ $customer->phone }}</div>
            @endif
            @if($customer->alternate_number)
              <div class="mt-8 strong">Alternate No.</div>
              <div class="muted">{{ $customer->alternate_number }}</div>
            @endif
          </td>
        </tr>
      </table>
    </div>

    <!-- Payment details -->
    <div class="row mt-12">
      <table>
        <thead>
          <tr>
            <th style="width:30%;">Description</th>
            <th style="width:20%;">Payment Method</th>
            <th style="width:25%;">Date</th>
            <th style="width:25%;">Amount (AED)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              @if($payment->is_advance)
                <div class="strong">Customer Advance</div>
              @elseif($payment->invoice)
                <div class="strong">Payment for Invoice {{ $payment->invoice->invoice_number }}</div>
              @else
                <div class="strong">Payment</div>
              @endif
              @if($payment->notes)
                <div style="font-size: 11px; margin-top: 4px;">{{ $payment->notes }}</div>
              @endif
            </td>
            <td>{{ $payment->payment_method ?? '—' }}</td>
            <td>{{ $payment->payment_date?->format('d-M-Y') }}</td>
            <td class="text-right strong">{{ number_format((float) $payment->amount, 2) }}</td>
          </tr>
          <!-- Total row -->
          <tr>
            <td colspan="3" class="strong" style="text-align:right;">Total Amount Received (AED)</td>
            <td class="text-right strong">{{ number_format((float) $payment->amount, 2) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Comments section -->
    @if($payment->notes)
      <div class="row mt-12">
        <div style="width:100%; font-size:12px;">
          <div class="mt-8 strong">Notes</div>
          <div style="min-height:40px; margin-top:4px;">
            {{ $payment->notes }}
          </div>
        </div>
      </div>
    @endif

    <!-- Prepared by section -->
    @if(!empty($preparedBy))
      <div class="row mt-12">
        <div style="width:100%; font-size:12px;">
          <div style="margin-top:40px; text-align:left;">
            <span>{{ $preparedBy }}</span><br>
            <span class="muted">Prepared by</span>
          </div>
        </div>
      </div>
    @endif

    @if($template && $template->footer_image_path)
      <div class="footer">
        <img class="footer-img" src="{{ public_path('storage/'.$template->footer_image_path) }}" alt="Footer">
      </div>
    @endif
  </body>
</html>
