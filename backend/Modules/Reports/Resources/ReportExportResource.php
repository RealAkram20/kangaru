<?php

namespace Modules\Reports\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Reports\Models\ReportExport;

/**
 * @mixin ReportExport
 */
class ReportExportResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'report' => $this->report,
            'report_label' => $this->report->label(),
            'format' => $this->format->value,
            'format_label' => $this->format->label(),
            'status' => $this->status->value,
            'filters' => $this->filters,
            'row_count' => $this->row_count,
            // What a row counts, so the client can render "12 periods"
            // without holding its own mapping. It used to say "trips" for
            // every export, which was already wrong for the driver and
            // vehicle reports.
            'row_noun' => $this->report->rowNoun(),
            'file_size' => $this->file_size,
            // The client needs to know whether to offer a download without
            // reimplementing the rule; expiry counts as not downloadable.
            'is_downloadable' => $this->status->isDownloadable() && ! $this->isExpired(),
            'is_terminal' => $this->status->isTerminal(),
            'error' => $this->error,
            'requested_by' => $this->whenLoaded('requestedBy', fn () => $this->requestedBy?->name),
            'expires_at' => $this->expires_at,
            'created_at' => $this->created_at,
            'finished_at' => $this->finished_at,
        ];
    }
}
