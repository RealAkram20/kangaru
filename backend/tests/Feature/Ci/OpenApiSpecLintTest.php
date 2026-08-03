<?php

/**
 * The spec lint (ADR-0011 decision 4).
 *
 * `additionalProperties` is the clause that makes response validation mean
 * anything: without it a response may carry any number of undeclared
 * fields and still validate — exactly the role_label / TripResource
 * failure mode this contract exists to prevent. It is also the easiest
 * line in the document to forget, so it is enforced rather than reviewed:
 * every object schema must DECLARE additionalProperties — `false` for a
 * fixed shape, or a value schema for a genuine map (validation errors,
 * audit diffs). What it may not be is absent, because absent means
 * "anything goes" and reads like nothing.
 */

use App\Enums\ErrorCode;
use Symfony\Component\Yaml\Yaml;

/**
 * @return array<int, string> spec locations of object schemas missing the declaration
 */
function objectSchemasMissingAdditionalProperties(mixed $node, string $location = ''): array
{
    if (! is_array($node)) {
        return [];
    }

    $offenders = [];

    $declaresObjectType = array_key_exists('type', $node) && (
        $node['type'] === 'object'
        || (is_array($node['type']) && in_array('object', $node['type'], true))
    );

    // `properties` alone also marks a schema as object-shaped: JSON Schema
    // applies it whenever the instance is an object, whether or not `type`
    // says so, and an author who wrote properties meant to describe one.
    $describesProperties = isset($node['properties']) && is_array($node['properties']);

    if (($declaresObjectType || $describesProperties) && ! array_key_exists('additionalProperties', $node)) {
        $offenders[] = $location === '' ? '(document root)' : $location;
    }

    foreach ($node as $key => $value) {
        $offenders = [...$offenders, ...objectSchemasMissingAdditionalProperties($value, $location.'/'.$key)];
    }

    return $offenders;
}

it('declares additionalProperties on every object schema in the spec', function () {
    $spec = Yaml::parseFile(base_path('../docs/api/openapi.yaml'));

    $offenders = objectSchemasMissingAdditionalProperties($spec);

    expect($offenders)->toBe([], sprintf(
        "Object schemas without an additionalProperties declaration — undeclared response fields would validate silently (ADR-0011):\n%s",
        implode("\n", $offenders),
    ));
});

it('enumerates every ErrorCode case in the error schema', function () {
    // AGENTS.md: clients branch on `code`, never on message text. That
    // instruction is only actionable if the contract's enum and the enum in
    // code cannot drift apart.
    $spec = Yaml::parseFile(base_path('../docs/api/openapi.yaml'));

    $documented = $spec['components']['schemas']['ErrorCode']['enum'] ?? [];
    $actual = array_map(fn (ErrorCode $case) => $case->value, ErrorCode::cases());

    sort($documented);
    sort($actual);

    expect($documented)->toBe($actual);
});
