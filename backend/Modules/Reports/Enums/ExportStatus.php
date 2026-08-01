<?php

namespace Modules\Reports\Enums;

enum ExportStatus: string
{
    case QUEUED = 'queued';
    case PROCESSING = 'processing';
    case COMPLETED = 'completed';
    case FAILED = 'failed';

    public function isTerminal(): bool
    {
        return in_array($this, [self::COMPLETED, self::FAILED], true);
    }

    /** Only a completed export has a file to hand back. */
    public function isDownloadable(): bool
    {
        return $this === self::COMPLETED;
    }
}
