<?php declare(strict_types = 1);

// odsl-C:\xampp\htdocs\Kangaru\backend\app\Support\Tenancy\TenantScope.php-PHPStan\BetterReflection\Reflection\ReflectionClass-App\Support\Tenancy\TenantScope
return \PHPStan\Cache\CacheItem::__set_state(array(
   'variableKey' => 'v2-6.70.0.3-8.3.32-f0eb784979315ca03e02b57970851b2347fe9baf7ba4b7ec92bcbcb87598efec',
   'data' => 
  array (
    'locatedSource' => 
    array (
      'class' => 'PHPStan\\BetterReflection\\SourceLocator\\Located\\LocatedSource',
      'data' => 
      array (
        'name' => 'App\\Support\\Tenancy\\TenantScope',
        'filename' => 'C:/xampp/htdocs/Kangaru/backend/app/Support/Tenancy/TenantScope.php',
      ),
    ),
    'namespace' => 'App\\Support\\Tenancy',
    'name' => 'App\\Support\\Tenancy\\TenantScope',
    'shortName' => 'TenantScope',
    'isInterface' => false,
    'isTrait' => false,
    'isEnum' => false,
    'isBackedEnum' => false,
    'modifiers' => 0,
    'docComment' => '/**
 * ADR-0001 enforcement point. Applied globally by the BelongsToTenant trait.
 *
 * Deliberately fails closed: if no tenant is bound to the request (e.g. a
 * background job or console command that never went through IdentifyTenant),
 * the scope excludes every row rather than silently returning all tenants\'
 * data. Cross-tenant/no-tenant code paths must explicitly opt out via
 * Model::allTenants() and set tenant_id manually — never rely on this scope
 * being absent by accident.
 */',
    'attributes' => 
    array (
    ),
    'startLine' => 19,
    'endLine' => 34,
    'startColumn' => 1,
    'endColumn' => 1,
    'parentClassName' => NULL,
    'implementsClassNames' => 
    array (
      0 => 'Illuminate\\Database\\Eloquent\\Scope',
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
      'apply' => 
      array (
        'name' => 'apply',
        'parameters' => 
        array (
          'builder' => 
          array (
            'name' => 'builder',
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
            'startLine' => 21,
            'endLine' => 21,
            'startColumn' => 27,
            'endColumn' => 42,
            'parameterIndex' => 0,
            'isOptional' => false,
          ),
          'model' => 
          array (
            'name' => 'model',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'Illuminate\\Database\\Eloquent\\Model',
                'isIdentifier' => false,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 21,
            'endLine' => 21,
            'startColumn' => 45,
            'endColumn' => 56,
            'parameterIndex' => 1,
            'isOptional' => false,
          ),
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
        'startLine' => 21,
        'endLine' => 33,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'App\\Support\\Tenancy',
        'declaringClassName' => 'App\\Support\\Tenancy\\TenantScope',
        'implementingClassName' => 'App\\Support\\Tenancy\\TenantScope',
        'currentClassName' => 'App\\Support\\Tenancy\\TenantScope',
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