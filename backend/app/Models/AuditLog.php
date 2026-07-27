<?php

namespace App\Models;

use App\Concerns\BelongsToTenant;
use App\Exceptions\AuditLogImmutableException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Arr;

/**
 * Append-only audit trail (AGENTS.md Observability: "Audit Log"). Written
 * exclusively via the static `record()` factory, called from the
 * `App\Concerns\Auditable` trait's model event listeners — never
 * constructed/saved directly elsewhere.
 *
 * Uses BelongsToTenant for tenant-scoped *reads* only. Its `creating`
 * auto-fill (from the acting request's TenantContext) is never actually
 * exercised here because `record()` always sets `tenant_id` explicitly,
 * sourced from the *audited entity's* own tenant_id — not the acting
 * user's. That distinction matters: a Super Admin (no tenant context of
 * their own) creating a Company for Tenant X must produce an audit row
 * scoped to Tenant X, not a tenant-less one.
 */
class AuditLog extends Model
{
    use BelongsToTenant;

    /**
     * No updated_at column exists — this table is append-only.
     */
    const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'user_id',
        'auditable_type',
        'auditable_id',
        'action',
        'changes',
        'ip_address',
    ];

    protected function casts(): array
    {
        return [
            'changes' => 'array',
        ];
    }

    public static function booted(): void
    {
        static::updating(function () {
            throw new AuditLogImmutableException;
        });

        static::deleting(function () {
            throw new AuditLogImmutableException;
        });
    }

    public function auditable(): MorphTo
    {
        return $this->morphTo();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * Builds and writes the audit row for one model-event occurrence.
     * Centralized here (rather than in the Auditable trait) so the diff
     * rules live in one place and are independently testable.
     */
    public static function record(Model $model, string $action): void
    {
        [$before, $after] = match ($action) {
            'created' => [null, $model->attributesToArray()],
            'deleted' => [$model->attributesToArray(), null],
            'updated' => self::diffForUpdate($model),
            default => throw new \InvalidArgumentException("Unknown audit action: {$action}"),
        };

        // An update whose only change was a timestamp touch (no business
        // field changed) has nothing worth auditing.
        if ($action === 'updated' && $before === null && $after === null) {
            return;
        }

        static::create([
            'tenant_id' => self::tenantIdFor($model),
            'user_id' => auth()->id(),
            'auditable_type' => $model->getMorphClass(),
            'auditable_id' => $model->getKey(),
            'action' => $action,
            'changes' => ['before' => $before, 'after' => $after],
            'ip_address' => app()->runningInConsole() ? null : request()->ip(),
        ]);
    }

    /**
     * Diffs only the business fields that actually changed. Eloquent's
     * performUpdate() calls updateTimestamps() before computing dirty
     * attributes, so `updated_at` is present in getChanges() on every
     * single save regardless of what changed — it (and created_at/
     * deleted_at) must be stripped or every diff is polluted with a
     * timestamp change that isn't a real business mutation.
     *
     * getChanges()/getOriginal() are safe to read here: getChanges() is
     * populated by syncChanges() immediately before the `updated` event
     * fires, and getOriginal() is still pre-save because syncOriginal()
     * only runs in finishSave(), which happens after the `saved` event —
     * which fires after `updated`. (Verified against Laravel 12 source,
     * Illuminate\Database\Eloquent\Model::performUpdate()/finishSave().)
     *
     * @return array{0: array<string, mixed>|null, 1: array<string, mixed>|null}
     */
    private static function diffForUpdate(Model $model): array
    {
        $ignore = array_filter([
            $model->getUpdatedAtColumn(),
            $model->getCreatedAtColumn(),
            method_exists($model, 'getDeletedAtColumn') ? $model->getDeletedAtColumn() : null,
        ]);

        $changedKeys = array_values(array_diff(
            array_keys($model->getChanges()),
            [...$ignore, ...$model->getHidden()],
        ));

        if ($changedKeys === []) {
            return [null, null];
        }

        $after = Arr::only($model->getChanges(), $changedKeys);
        $before = collect($changedKeys)->mapWithKeys(fn ($key) => [$key => $model->getOriginal($key)])->all();

        return [$before, $after];
    }

    private static function tenantIdFor(Model $model): ?int
    {
        return in_array('tenant_id', $model->getFillable(), true)
            ? $model->getAttribute('tenant_id')
            : null;
    }
}
