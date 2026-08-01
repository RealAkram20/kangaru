<?php

namespace Modules\Notifications\Notifications;

use Modules\Notifications\Enums\NotificationType;
use Modules\Reports\Models\ReportExport;

/**
 * Tells whoever asked for a report file that it is ready.
 *
 * Closes the gap Modules/Reports names in its deferred list: the export
 * runs on a queue and returns 202, so until now the only way to learn it
 * had finished was to leave the page open and let it poll.
 *
 * In-app only by default. An export the requester asked for seconds ago
 * does not warrant an email, and AGENTS.md's instruction is to avoid
 * notification fatigue — a config entry can add mail for a deployment
 * whose users request month-end reports and walk away.
 */
class ReportExportReadyNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $exportId,
        private readonly string $reportLabel,
        private readonly string $formatLabel,
        private readonly ?int $rowCount,
        private readonly string $rowNoun,
    ) {}

    public static function for(ReportExport $export): self
    {
        return new self(
            $export->id,
            $export->report->label(),
            $export->format->label(),
            $export->row_count,
            $export->report->rowNoun(),
        );
    }

    public function type(): NotificationType
    {
        return NotificationType::REPORT_EXPORT_READY;
    }

    public function subject(): string
    {
        return "{$this->reportLabel} is ready to download";
    }

    public function body(): string
    {
        $size = $this->rowCount === null
            ? ''
            : ' covering '.number_format($this->rowCount).' '.$this->rowNoun;

        // The retention window is in the message because the file is
        // deleted on a schedule and the row outlives it — a recipient who
        // reads this in a fortnight would otherwise follow a dead link with
        // no explanation.
        return "Your {$this->reportLabel} ({$this->formatLabel}){$size} has finished generating "
            .'and is ready to download. Exported files are kept for '
            .(int) config('reports.export.retention_days').' days.';
    }

    public function url(): ?string
    {
        return '/reports';
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'export_id' => $this->exportId,
            'report' => $this->reportLabel,
            'format' => $this->formatLabel,
            'row_count' => $this->rowCount,
        ];
    }
}
