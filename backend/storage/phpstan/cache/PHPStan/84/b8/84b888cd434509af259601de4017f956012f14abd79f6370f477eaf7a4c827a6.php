<?php declare(strict_types = 1);

// odsl-C:\xampp\htdocs\Kangaru\backend\app\Logging\CustomizeLogger.php-PHPStan\BetterReflection\Reflection\ReflectionClass-App\Logging\CustomizeLogger
return \PHPStan\Cache\CacheItem::__set_state(array(
   'variableKey' => 'v2-6.70.0.3-8.3.32-b4d94e2a2fb3d6b5f44c7d67c82c68d112df59b75d73bace2943c5df66140158',
   'data' => 
  array (
    'locatedSource' => 
    array (
      'class' => 'PHPStan\\BetterReflection\\SourceLocator\\Located\\LocatedSource',
      'data' => 
      array (
        'name' => 'App\\Logging\\CustomizeLogger',
        'filename' => 'C:/xampp/htdocs/Kangaru/backend/app/Logging/CustomizeLogger.php',
      ),
    ),
    'namespace' => 'App\\Logging',
    'name' => 'App\\Logging\\CustomizeLogger',
    'shortName' => 'CustomizeLogger',
    'isInterface' => false,
    'isTrait' => false,
    'isEnum' => false,
    'isBackedEnum' => false,
    'modifiers' => 0,
    'docComment' => '/**
 * Monolog "tap" (config/logging.php stack.tap) that forces structured JSON
 * output on every handler, so request_id/tenant_id/user_id context
 * (attached via Illuminate\\Support\\Facades\\Context in middleware) shows up
 * on every log line in every environment.
 */',
    'attributes' => 
    array (
    ),
    'startLine' => 15,
    'endLine' => 25,
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
      '__invoke' => 
      array (
        'name' => '__invoke',
        'parameters' => 
        array (
          'logger' => 
          array (
            'name' => 'logger',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'Illuminate\\Log\\Logger',
                'isIdentifier' => false,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 17,
            'endLine' => 17,
            'startColumn' => 30,
            'endColumn' => 43,
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
            'name' => 'void',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => NULL,
        'startLine' => 17,
        'endLine' => 24,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'App\\Logging',
        'declaringClassName' => 'App\\Logging\\CustomizeLogger',
        'implementingClassName' => 'App\\Logging\\CustomizeLogger',
        'currentClassName' => 'App\\Logging\\CustomizeLogger',
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