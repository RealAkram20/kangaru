<?php declare(strict_types = 1);

// odsl-C:\xampp\htdocs\Kangaru\backend\Modules\Clients\Models\Company.php-PHPStan\BetterReflection\Reflection\ReflectionClass-Modules\Clients\Models\Company
return \PHPStan\Cache\CacheItem::__set_state(array(
   'variableKey' => 'v2-6.70.0.3-8.3.32-cf0ab322c1846d861c318e436bf96783edeb3d21e21c1114708b73b7963206f1',
   'data' => 
  array (
    'locatedSource' => 
    array (
      'class' => 'PHPStan\\BetterReflection\\SourceLocator\\Located\\LocatedSource',
      'data' => 
      array (
        'name' => 'Modules\\Clients\\Models\\Company',
        'filename' => 'C:/xampp/htdocs/Kangaru/backend/Modules/Clients/Models/Company.php',
      ),
    ),
    'namespace' => 'Modules\\Clients\\Models',
    'name' => 'Modules\\Clients\\Models\\Company',
    'shortName' => 'Company',
    'isInterface' => false,
    'isTrait' => false,
    'isEnum' => false,
    'isBackedEnum' => false,
    'modifiers' => 0,
    'docComment' => '/**
 * The corporate client\'s business profile — one per Tenant in Phase 1.
 * First real exercise of BelongsToTenant/TenantScope (ADR-0001).
 *
 * @property int $id
 * @property int $tenant_id
 * @property string $legal_name
 * @property int $credit_limit_minor
 * @property string $status
 */',
    'attributes' => 
    array (
    ),
    'startLine' => 22,
    'endLine' => 53,
    'startColumn' => 1,
    'endColumn' => 1,
    'parentClassName' => 'Illuminate\\Database\\Eloquent\\Model',
    'implementsClassNames' => 
    array (
    ),
    'traitClassNames' => 
    array (
      0 => 'App\\Concerns\\BelongsToTenant',
      1 => 'Illuminate\\Database\\Eloquent\\Factories\\HasFactory',
      2 => 'Illuminate\\Database\\Eloquent\\SoftDeletes',
    ),
    'immediateConstants' => 
    array (
    ),
    'immediateProperties' => 
    array (
      'fillable' => 
      array (
        'declaringClassName' => 'Modules\\Clients\\Models\\Company',
        'implementingClassName' => 'Modules\\Clients\\Models\\Company',
        'name' => 'fillable',
        'modifiers' => 2,
        'type' => NULL,
        'default' => 
        array (
          'code' => '[\'tenant_id\', \'legal_name\', \'trading_name\', \'registration_number\', \'industry\', \'billing_email\', \'phone\', \'address_line1\', \'address_line2\', \'city\', \'country\', \'credit_limit_minor\', \'status\']',
          'attributes' => 
          array (
            'startLine' => 26,
            'endLine' => 40,
            'startTokenPos' => 66,
            'startFilePos' => 699,
            'endTokenPos' => 107,
            'endFilePos' => 998,
          ),
        ),
        'docComment' => NULL,
        'attributes' => 
        array (
        ),
        'startLine' => 26,
        'endLine' => 40,
        'startColumn' => 5,
        'endColumn' => 6,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
    ),
    'immediateMethods' => 
    array (
      'casts' => 
      array (
        'name' => 'casts',
        'parameters' => 
        array (
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'array',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => NULL,
        'startLine' => 42,
        'endLine' => 47,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 2,
        'namespace' => 'Modules\\Clients\\Models',
        'declaringClassName' => 'Modules\\Clients\\Models\\Company',
        'implementingClassName' => 'Modules\\Clients\\Models\\Company',
        'currentClassName' => 'Modules\\Clients\\Models\\Company',
        'aliasName' => NULL,
      ),
      'tenant' => 
      array (
        'name' => 'tenant',
        'parameters' => 
        array (
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'Illuminate\\Database\\Eloquent\\Relations\\BelongsTo',
            'isIdentifier' => false,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => NULL,
        'startLine' => 49,
        'endLine' => 52,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Modules\\Clients\\Models',
        'declaringClassName' => 'Modules\\Clients\\Models\\Company',
        'implementingClassName' => 'Modules\\Clients\\Models\\Company',
        'currentClassName' => 'Modules\\Clients\\Models\\Company',
        'aliasName' => NULL,
      ),
    ),
    'traitsData' => 
    array (
      'aliases' => 
      array (
      ),
      'modifiers' => 
      array (
      ),
      'precedences' => 
      array (
      ),
      'hashes' => 
      array (
      ),
    ),
  ),
));