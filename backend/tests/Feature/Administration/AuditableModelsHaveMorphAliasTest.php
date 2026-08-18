<?php

use App\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\File;
use Modules\Clients\Models\Company;

/**
 * Every model using `App\Concerns\Auditable` must have a morph alias.
 *
 * The morph map is *enforced* (`Relation::enforceMorphMap`), so an unmapped
 * model does not fall back to its FQCN — `getMorphClass()` throws
 * `ClassMorphViolationException`. `Auditable` records on `created`, which
 * means an unmapped auditable model **cannot be created at all**.
 *
 * That is not hypothetical. `VehicleAllocation` shipped with ADR-0005
 * carrying `Auditable` and no morph entry, and every insert into
 * `vehicle_allocations` threw. Nothing caught it because nothing writes to
 * that table yet — the failure was waiting for the first feature that did.
 *
 * Discovered by filesystem scan rather than a hand-kept list: a list is
 * exactly the thing that was already out of date.
 *
 * **The scan reads classes, not file text.** An earlier version skipped any
 * file that did not literally contain `App\Concerns\Auditable`, which was
 * fast and wrong: a model that inherits the trait from an abstract parent
 * — `RateCardZoneRate` extends `PricedRate` — never mentions it, so it was
 * silently never checked. Removing its morph entry left this file green,
 * which is the precise failure the file exists to prevent. `class_exists`
 * plus `class_uses_recursive` costs an autoload per file and cannot be
 * fooled by where the `use` statement happens to sit.
 */

/**
 * @return array<int, class-string>
 */
function auditableModels(): array
{
    $roots = [base_path('app/Models'), base_path('Modules')];
    $models = [];

    foreach ($roots as $root) {
        if (! File::isDirectory($root)) {
            continue;
        }

        foreach (File::allFiles($root) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            if (! preg_match('/namespace\s+([^;]+);/', $file->getContents(), $ns)) {
                continue;
            }

            $class = trim($ns[1]).'\\'.$file->getFilenameWithoutExtension();

            if (! class_exists($class) || ! is_subclass_of($class, Model::class)) {
                continue;
            }

            if (! in_array(Auditable::class, class_uses_recursive($class), true)) {
                continue;
            }

            // An abstract model is never instantiated and never audited on
            // its own — `Modules\Billing\Models\PricedRate` carries the trait
            // so that `RateCardRate` and `RateCardZoneRate` inherit it, and
            // those two are what need aliases. Requiring one for the parent
            // would demand a morph entry for a class no row can ever be.
            //
            // Narrow on purpose: only `abstract` is skipped, so a concrete
            // auditable model still cannot slip past this scan.
            if ((new ReflectionClass($class))->isAbstract()) {
                continue;
            }

            $models[] = $class;
        }
    }

    return array_values(array_unique($models));
}

it('finds the auditable models at all', function () {
    // A scan that silently matched nothing would make every assertion below
    // vacuously true — the failure mode this whole file exists to prevent.
    expect(auditableModels())->not->toBeEmpty();
    expect(auditableModels())->toContain(Company::class);
});

it('gives every auditable model a morph alias, so it can be created', function () {
    $map = array_flip(Relation::morphMap());
    $missing = [];

    foreach (auditableModels() as $class) {
        if (! isset($map[$class])) {
            $missing[] = $class;
        }
    }

    expect($missing)->toBe(
        [],
        'These models are Auditable but absent from the enforced morph map in '.
        'AppServiceProvider. Creating any of them throws '.
        'ClassMorphViolationException from AuditLog::record(): '.implode(', ', $missing),
    );
});

it('resolves a morph class for every auditable model without throwing', function () {
    // The map lookup above proves the alias exists; this proves the thing
    // that actually happens at runtime, which is the call Auditable makes.
    foreach (auditableModels() as $class) {
        /** @var Model $model */
        $model = new $class;

        expect($model->getMorphClass())->toBeString();
    }
});
