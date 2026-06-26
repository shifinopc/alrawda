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
        <p class="h1">TAX INVOICE</p>
      </div>
    </div>

    <!-- Invoice / customer info block -->
    <div class="row mt-12">
      <table>
        <tr>
          <td style="width:50%; vertical-align:top; padding:10px;">
            <div class="strong">TRN</div>
            <div class="muted">{{ $company?->trn_number ?? '—' }}</div>
            <div class="mt-8 strong">Invoice No</div>
            <div class="muted">{{ $invoice->invoice_number }}</div>
            <div class="mt-8 strong">Date</div>
            <div class="muted">{{ $invoice->invoice_date?->format('d-M-Y') }}</div>
          </td>
          <td style="width:50%; vertical-align:top; padding:10px;">
            <div class="strong">Customer Ref.</div>
            <div class="muted">{{ $invoice->customer->customer_ref ?? '—' }}</div>
            <div class="mt-8 strong">Customer Name</div>
            <div class="muted">{{ $invoice->customer->name }}</div>
            <div class="mt-8 strong">Mobile No.</div>
            <div class="muted">{{ $invoice->customer->phone ?? '—' }}</div>
            <div class="mt-8 strong">Alternate No.</div>
            <div class="muted">{{ $invoice->customer->alternate_number ?? '—' }}</div>
          </td>
        </tr>
      </table>
    </div>

    <div class="row mt-12">
      <table>
        <thead>
          <tr>
            <th style="width:6%;">Sl. No</th>
            <th style="width:34%;">Service / Package</th>
            <th style="width:8%;">Qty</th>
            <th style="width:17%;">Non Taxable Amount</th>
            <th style="width:17%;">Taxable Amount</th>
            <th style="width:8%;">Tax</th>
            <th style="width:10%;">Total</th>
          </tr>
        </thead>
        <tbody>
          @foreach($invoice->items as $index => $it)
            <tr>
              <td style="text-align:center;">{{ $index + 1 }}</td>
              <td>
                @if($it->package_id)
                  <div class="strong">{{ $it->package->name }}</div>
                  @if($it->package->description)
                    <div style="font-size: 11px;">{{ $it->package->description }}</div>
                  @endif
                @else
                  <div class="strong">{{ $it->service->name }}</div>
                  @if($it->service->description)
                    <div style="font-size: 11px;">{{ $it->service->description }}</div>
                  @endif
                @endif
              </td>
              <td class="text-right">{{ $it->quantity }}</td>
              <td class="text-right">{{ number_format((float) $it->non_taxable_amount, 2) }}</td>
              <td class="text-right">{{ number_format((float) $it->taxable_amount, 2) }}</td>
              <td class="text-right">{{ number_format((float) $it->line_tax, 2) }}</td>
              <td class="text-right strong">{{ number_format((float) $it->line_total, 2) }}</td>
            </tr>
          @endforeach
          <!-- Totals rows -->
          <tr>
            <td colspan="5" class="strong" style="text-align:right;">Total Amount</td>
            <td colspan="2" class="text-right strong">{{ number_format((float) $invoice->grand_total - $invoice->vat_amount, 2) }}</td>
          </tr>
          <tr>
            <td colspan="5" class="strong" style="text-align:right;">Total Tax ({{ number_format((float) ($invoice->subtotal_taxable ? ($invoice->vat_amount / $invoice->subtotal_taxable) * 100 : 0), 0) }}%)</td>
            <td colspan="2" class="text-right strong">{{ number_format((float) $invoice->vat_amount, 2) }}</td>
          </tr>
          <tr>
            <td colspan="5" class="strong" style="text-align:right;">Net Total (AED)</td>
            <td colspan="2" class="text-right strong">{{ number_format((float) $invoice->grand_total, 2) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Comments and prepared by section -->
    <div class="row mt-12">
      <div style="width:100%; font-size:12px;">
        <div class="muted">Kindly check the invoice and documents before leaving the counter.</div>
        <div class="mt-8 strong">Comments</div>
        <div style="min-height:40px; margin-top:4px;">
          {{ $invoice->notes ?? '' }}
        </div>
        @if(!empty($preparedBy))
          <div style="margin-top:40px; text-align:left;">
            <span>{{ $preparedBy }}</span><br>
            <span class="muted">Prepared by</span>
          </div>
        @endif
      </div>
    </div>

    @if($template && $template->footer_image_path)
      <div class="footer">
        <img class="footer-img" src="{{ public_path('storage/'.$template->footer_image_path) }}" alt="Footer">
      </div>
    @endif
  </body>
</html>

