<?php

namespace Modules\Reports\Models;

use App\Concerns\BelongsToTenant;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;

/**
 * A requested report file and the state of producing it.
 *
 * Tenant-scoped like everything else (ADR-0001), which is what makes the
 * download endpoint safe: an export id from another tenant resolves to
 * nothing and returns 404, never another company's trip data.
 *
 * Not Auditable: an export reads data, it does not change any, so it has
 * nothing to diff. The row itself is the record that it happened.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $requested_by_user_id
 * @property ExportFormat $format
 * @property ExportStatus $status
 * @property array<string, mixed> $filters
 * @property string|null $path
 * @property int|null $row_count
 * @property int|null $file_size
 * @property string|null $error
 * @property CarbonInterface|null $started_at
 * @property CarbonInterface|null $finished_at
 * @property CarbonInterface|null $expires_at
 * @property CarbonInterface $created_at
 * @property-read User|null $requestedBy
 */
class ReportExport extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'requested_by_user_id',
        'report',
        'format',
        'status',
        'filters',
        'path',
        'row_count',
        'file_size',
        'error',
        'started_at',
        'finished_at',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'format' => ExportFormat::class,
            'status' => ExportStatus::class,
            'filters' => 'array',
            'row_count' => 'integer',
            'file_size' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Tenant, $this> */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** @return BelongsTo<User, $this> */
    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by_user_id');
    }

    /**
     * ADR-0001 requires tenant-prefixed storage paths. Built here rather
     * than at the call site so every export lands under its own tenant's
     * directory by construction, not by remembering to.
     */
    public function buildPath(string $filename): string
    {
        return "tenants/{$this->tenant_id}/reports/{$this->id}/{$filename}";
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }
}
