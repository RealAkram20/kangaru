<?php

namespace Tests\Support;

use Osteel\OpenApi\Testing\Validator;
use Osteel\OpenApi\Testing\ValidatorBuilder;

/**
 * One validator per process — deliberately NOT a static on the trait that
 * uses it. Pest compiles every test file into its own class, and a trait's
 * static property is per-using-class, so a trait-held memo would parse the
 * spec once per file and pin every copy for the life of the process. That
 * is not a micro-optimisation: it exhausted the 128M memory limit halfway
 * through the suite the first time it ran.
 */
final class ApiContractValidator
{
    private static ?Validator $validator = null;

    public static function instance(): Validator
    {
        return self::$validator ??= ValidatorBuilder::fromYamlFile(
            dirname(__DIR__, 2).'/../docs/api/openapi.yaml',
        )->getValidator();
    }
}
