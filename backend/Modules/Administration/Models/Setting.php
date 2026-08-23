<?php

namespace Modules\Administration\Models;

use App\Concerns\Auditable;
use App\Concerns\InheritsKangaruDefaults;
use Illuminate\Database\Eloquent\Model;

/**
 * One platform setting (ADR-0014). Rows exist only for keys the
 * catalogue in SettingsService names; everything else is refused at the
 * service, which is also the only writer.
 *
 * Secret values arrive here already encrypted by the service (Crypt),
 * deliberately not via an `encrypted` cast: Auditable snapshots cast
 * attributes, and a cast would decrypt the secret straight into the
 * append-only audit log. With the service owning encryption, the audit
 * trail sees ciphertext at worst — and attributesToArray() below masks
 * even that.
 */
class Setting extends Model
{
    use Auditable, InheritsKangaruDefaults;

    protected $fillable = ['operator_id', 'group', 'key', 'value', 'is_secret'];

    protected function casts(): array
    {
        return [
            'value' => 'array',
            'is_secret' => 'boolean',
        ];
    }

    /**
     * Masks secret values everywhere attributes are exported — which
     * includes the Auditable trait's created/deleted snapshots.
     *
     * @return array<string, mixed>
     */
    public function attributesToArray(): array
    {
        $attributes = parent::attributesToArray();

        if ($this->is_secret) {
            $attributes['value'] = '***';
        }

        return $attributes;
    }
}
