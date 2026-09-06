<?php

namespace Modules\Billing\Services;

use App\Models\Operator;
use Barryvdh\DomPDF\Facade\Pdf;
use Modules\Administration\Services\SettingsService;
use Modules\Billing\Models\Invoice;
use Modules\Notifications\Mail\MailMoney;

/**
 * The invoice as a PDF, for attaching to the email that announces it.
 *
 * ## Why a file as well as a link
 *
 * The owner's decision (mail plan §10, 23 August): both. Finance staff forward
 * the file to a colleague and attach it to a payment request; auditors follow
 * the link to the live record, which is the reproducible one. Serving only one
 * loses one of those readers.
 *
 * ## It recalculates nothing
 *
 * Every figure is read off the stored invoice and its lines and formatted.
 * PRODUCT.md's positioning is that an invoice is fully reproducible from
 * stored data; a renderer that did its own arithmetic would become a second
 * place the total comes from, and the two would eventually disagree.
 *
 * ## Built at send time and never stored
 *
 * There is no `invoices.pdf_path`. The document is deterministic from rows
 * that are already immutable, so a stored copy would be a cache with no
 * invalidation story and one more thing to back up. If a client asks for it
 * again, it is regenerated identically.
 */
class InvoicePdf
{
    public function __construct(private readonly SettingsService $settings) {}

    /**
     * The rendered bytes.
     *
     * Returned rather than written to disk, because the caller is building a
     * queued email: the worker that sends it is a different process, and a
     * temporary file is exactly the thing that is gone by then.
     */
    public function render(Invoice $invoice): string
    {
        $invoice->loadMissing(['lines', 'tenant']);

        $lines = $invoice->lines->map(fn ($line) => [
            'description' => (string) $line->description,
            'amount' => MailMoney::format(
                (int) $line->amount_minor->getMinorAmount()->toInt(),
                (string) $invoice->currency,
            ),
        ])->all();

        return Pdf::loadView('billing.invoice-pdf', [
            'invoice' => $invoice,
            'appName' => (string) $this->settings->get('branding', 'app_name'),
            'billedTo' => (string) ($invoice->tenant->name ?? ''),
            // Null rather than the platform's name. An invoice that says
            // "served by KangaruRide" when a fleet ran the trips is wrong on a
            // document somebody may have to defend, so the row is omitted when
            // the answer is not known here.
            'servedBy' => $this->servedBy($invoice),
            'lines' => $lines,
            'total' => MailMoney::format(
                (int) $invoice->total_minor->getMinorAmount()->toInt(),
                (string) $invoice->currency,
            ),
        ])->setPaper('a4')->output();
    }

    /** The filename a finance officer will see in their inbox and their folder. */
    public function filename(Invoice $invoice): string
    {
        // The invoice number and nothing else. A timestamp or a client name in
        // the filename means two downloads of one document do not overwrite
        // each other, which is how somebody ends up paying the same invoice
        // twice from two files.
        return $invoice->invoice_number.'.pdf';
    }

    private function servedBy(Invoice $invoice): ?string
    {
        $operatorId = $invoice->operator_id ?? null;

        if ($operatorId === null) {
            return null;
        }

        return Operator::query()->whereKey($operatorId)->value('name');
    }
}
