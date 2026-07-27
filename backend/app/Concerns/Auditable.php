<?php

namespace App\Concerns;

use App\Models\AuditLog;

/**
 * Applies AGENTS.md's audit-log requirement to a model: every create,
 * update, and delete is recorded to the append-only audit_logs table.
 * All diff/write logic lives in AuditLog::record() — this trait only
 * wires the three Eloquent model events to it.
 */
trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(fn ($model) => AuditLog::record($model, 'created'));
        static::updated(fn ($model) => AuditLog::record($model, 'updated'));
        static::deleted(fn ($model) => AuditLog::record($model, 'deleted'));
    }
}
