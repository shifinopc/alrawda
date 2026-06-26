<?php

namespace App\Console\Commands;

use App\Mail\OverdueInvoiceReminder;
use App\Models\Invoice;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;

class SendOverdueReminders extends Command
{
    protected $signature = 'invoices:send-overdue-reminders';
    protected $description = 'Send email reminders for overdue invoices';

    public function handle(): int
    {
        $overdue = Invoice::with('customer')
            ->whereIn('status', ['approved', 'partially_paid'])
            ->get()
            ->filter(function ($inv) {
                $dueDate = $inv->due_date ?? $inv->invoice_date;
                return $inv->outstandingAmount() > 0 && $dueDate && $dueDate->isPast();
            });

        $admin = User::first();
        if (! $admin?->email) {
            $this->warn('No admin email configured. Skipping reminders.');
            return 0;
        }

        foreach ($overdue as $invoice) {
            Mail::to($admin->email)->send(new OverdueInvoiceReminder($invoice));
            $this->info("Sent reminder for {$invoice->invoice_number}");
        }

        $this->info("Sent {$overdue->count()} overdue reminder(s).");
        return 0;
    }
}
