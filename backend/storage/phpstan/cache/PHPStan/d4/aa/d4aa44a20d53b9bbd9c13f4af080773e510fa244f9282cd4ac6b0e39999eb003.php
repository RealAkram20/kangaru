<?php declare(strict_types = 1);

// odsl-C:\xampp\htdocs\Kangaru\backend\app\Concerns\BelongsToTenant.php-PHPStan\BetterReflection\Reflection\ReflectionClass-App\Concerns\BelongsToTenant
return \PHPStan\Cache\CacheItem::__set_state(array(
   'variableKey' => 'v2-6.70.0.3-8.3.32-233c4f5ad5af1a998fb310b4e860933366c41a7a731cc6153a70ce0be84f3b17',
   'data' => 
  array (
    'locatedSource' => 
    array (
      'class' => 'PHPStan\\BetterReflection\\SourceLocator\\Located\\LocatedSource',
      'data' => 
      array (
        'name' => 'App\\Concerns\\BelongsToTenant',
        'filename' => 'C:/xampp/htdocs/Kangaru/backend/app/Concerns/BelongsToTenant.php',
      ),
    ),
    'namespace' => 'App\\Concerns',
    'name' => 'App\\Concerns\\BelongsToTenant',
    'shortName' => 'BelongsToTenant',
    'isInterface' => false,
    'isTrait' => true,
    'isEnum' => false,
    'isBackedEnum' => false,
    'modifiers' => 0,
    'docComment' => '/**
 * ADR-0001: applies the mandatory tenant-scoping global scope and
 * auto-fills tenant_id from the request\'s TenantContext on create.
 *
 * The withoutGlobalScope opt-out (scopeAllTenants) is the "rare and
 * reviewed" exception ADR-0001 describes — used only by Super-Admin-gated
 * platform-level actions and by seeders/tests, never by ordinary request
 * handling.
 */',
    'attributes' => 
    array (
    ),
    'startLine' => 18,
    'endLine' => 35,
    'startColumn' => 1,
    'endColumn' => 1,
    'parentClassName' => NULL,
    'implementsClassNames' => 
    array (
    ),
    'traitClassNames' => 
    array (
    ),
    'immediateConstants' => 
    array (
    ),
    'immediateProperties' => 
    array (
    ),
    'immediateMethods' => 
    array (
      'bootBelongsToTenant' => 
      array (
        'name' => 'bootBelongsToTenant',
        'parameters' => 
        array (
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'void',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => NULL,
        'startLine' => 20,
        'endLine' => 29,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 17,
        'namespace' => 'App\\Concerns',
        'declaringClassName' => 'App\\Concerns\\BelongsToTenant',
        'implementingClassName' => 'App\\Concerns\\BelongsToTenant',
        'currentClassName' => 'App\\Concerns\\BelongsToTenant',
        'aliasName' => NULL,
      ),
      'scopeAllTenants' => 
      array (
        'name' => 'scopeAllTenants',
        'parameters' => 
        array (
          'query' => 
          array (
            'name' => 'query',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'Illuminate\\Database\\Eloquent\\Builder',
                'isIdentifier' => false,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 31,
            'endLine' => 31,
            'startColumn' => 37,
            'endColumn' => 50,
            'parameterIndex' => 0,
            'isOptional' => false,
          ),
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'Illuminate\\Database\\Eloquent\\Builder',
            'isIdentifier' => false,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => NULL,
        'startLine' => 31,
        'endLine' => 34,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'App\\Concerns',
        'declaringClassName' => 'App\\Concerns\\BelongsToTenant',
        'implementingClassName' => 'App\\Concerns\\BelongsToTenant',
        'currentClassName' => 'App\\Concerns\\BelongsToTenant',
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