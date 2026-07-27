<?php declare(strict_types = 1);

// osfsl-C:/xampp/htdocs/Kangaru/backend/vendor/composer/../laravel/framework/src/Illuminate/Contracts/Database/ModelIdentifier.php-PHPStan\BetterReflection\Reflection\ReflectionClass-Illuminate\Contracts\Database\ModelIdentifier
return \PHPStan\Cache\CacheItem::__set_state(array(
   'variableKey' => 'v2-c0eb07d63f0ac8d7a5870e5c24dcf5d75798a7ac89361b820fc18bdda80cab8a-8.3.32-6.70.0.3',
   'data' => 
  array (
    'locatedSource' => 
    array (
      'class' => 'PHPStan\\BetterReflection\\SourceLocator\\Located\\LocatedSource',
      'data' => 
      array (
        'name' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'filename' => 'C:/xampp/htdocs/Kangaru/backend/vendor/composer/../laravel/framework/src/Illuminate/Contracts/Database/ModelIdentifier.php',
      ),
    ),
    'namespace' => 'Illuminate\\Contracts\\Database',
    'name' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
    'shortName' => 'ModelIdentifier',
    'isInterface' => false,
    'isTrait' => false,
    'isEnum' => false,
    'isBackedEnum' => false,
    'modifiers' => 0,
    'docComment' => NULL,
    'attributes' => 
    array (
    ),
    'startLine' => 7,
    'endLine' => 105,
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
      'useMorphMap' => 
      array (
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'name' => 'useMorphMap',
        'modifiers' => 18,
        'type' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'bool',
            'isIdentifier' => true,
          ),
        ),
        'default' => 
        array (
          'code' => 'false',
          'attributes' => 
          array (
            'startLine' => 12,
            'endLine' => 12,
            'startTokenPos' => 30,
            'startFilePos' => 254,
            'endTokenPos' => 30,
            'endFilePos' => 258,
          ),
        ),
        'docComment' => '/**
 * Use the Relation morphMap for a Model\'s name when serializing.
 */',
        'attributes' => 
        array (
        ),
        'startLine' => 12,
        'endLine' => 12,
        'startColumn' => 5,
        'endColumn' => 47,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'class' => 
      array (
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'name' => 'class',
        'modifiers' => 1,
        'type' => NULL,
        'default' => NULL,
        'docComment' => '/**
 * The class name of the model.
 *
 * @var class-string<\\Illuminate\\Database\\Eloquent\\Model>|string|null
 */',
        'attributes' => 
        array (
        ),
        'startLine' => 19,
        'endLine' => 19,
        'startColumn' => 5,
        'endColumn' => 18,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'id' => 
      array (
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'name' => 'id',
        'modifiers' => 1,
        'type' => NULL,
        'default' => NULL,
        'docComment' => '/**
 * The unique identifier of the model.
 *
 * This may be either a single ID or an array of IDs.
 *
 * @var mixed
 */',
        'attributes' => 
        array (
        ),
        'startLine' => 28,
        'endLine' => 28,
        'startColumn' => 5,
        'endColumn' => 15,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'relations' => 
      array (
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'name' => 'relations',
        'modifiers' => 1,
        'type' => NULL,
        'default' => NULL,
        'docComment' => '/**
 * The relationships loaded on the model.
 *
 * @var array
 */',
        'attributes' => 
        array (
        ),
        'startLine' => 35,
        'endLine' => 35,
        'startColumn' => 5,
        'endColumn' => 22,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'connection' => 
      array (
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'name' => 'connection',
        'modifiers' => 1,
        'type' => NULL,
        'default' => NULL,
        'docComment' => '/**
 * The connection name of the model.
 *
 * @var string|null
 */',
        'attributes' => 
        array (
        ),
        'startLine' => 42,
        'endLine' => 42,
        'startColumn' => 5,
        'endColumn' => 23,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'collectionClass' => 
      array (
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'name' => 'collectionClass',
        'modifiers' => 1,
        'type' => NULL,
        'default' => NULL,
        'docComment' => '/**
 * The class name of the model collection.
 *
 * @var class-string<\\Illuminate\\Database\\Eloquent\\Collection>|null
 */',
        'attributes' => 
        array (
        ),
        'startLine' => 49,
        'endLine' => 49,
        'startColumn' => 5,
        'endColumn' => 28,
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
      '__construct' => 
      array (
        'name' => '__construct',
        'parameters' => 
        array (
          'class' => 
          array (
            'name' => 'class',
            'default' => NULL,
            'type' => NULL,
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 59,
            'endLine' => 59,
            'startColumn' => 33,
            'endColumn' => 38,
            'parameterIndex' => 0,
            'isOptional' => false,
          ),
          'id' => 
          array (
            'name' => 'id',
            'default' => NULL,
            'type' => NULL,
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 59,
            'endLine' => 59,
            'startColumn' => 41,
            'endColumn' => 43,
            'parameterIndex' => 1,
            'isOptional' => false,
          ),
          'relations' => 
          array (
            'name' => 'relations',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'array',
                'isIdentifier' => true,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 59,
            'endLine' => 59,
            'startColumn' => 46,
            'endColumn' => 61,
            'parameterIndex' => 2,
            'isOptional' => false,
          ),
          'connection' => 
          array (
            'name' => 'connection',
            'default' => NULL,
            'type' => NULL,
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 59,
            'endLine' => 59,
            'startColumn' => 64,
            'endColumn' => 74,
            'parameterIndex' => 3,
            'isOptional' => false,
          ),
        ),
        'returnsReference' => false,
        'returnType' => NULL,
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * Create a new model identifier.
 *
 * @param  class-string<\\Illuminate\\Database\\Eloquent\\Model>|null  $class
 * @param  mixed  $id
 * @param  array  $relations
 * @param  mixed  $connection
 */',
        'startLine' => 59,
        'endLine' => 69,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Illuminate\\Contracts\\Database',
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'currentClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'aliasName' => NULL,
      ),
      'useCollectionClass' => 
      array (
        'name' => 'useCollectionClass',
        'parameters' => 
        array (
          'collectionClass' => 
          array (
            'name' => 'collectionClass',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionUnionType',
              'data' => 
              array (
                'types' => 
                array (
                  0 => 
                  array (
                    'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
                    'data' => 
                    array (
                      'name' => 'string',
                      'isIdentifier' => true,
                    ),
                  ),
                  1 => 
                  array (
                    'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
                    'data' => 
                    array (
                      'name' => 'null',
                      'isIdentifier' => true,
                    ),
                  ),
                ),
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 77,
            'endLine' => 77,
            'startColumn' => 40,
            'endColumn' => 63,
            'parameterIndex' => 0,
            'isOptional' => false,
          ),
        ),
        'returnsReference' => false,
        'returnType' => NULL,
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * Specify the collection class that should be used when serializing / restoring collections.
 *
 * @param  class-string<\\Illuminate\\Database\\Eloquent\\Collection>  $collectionClass
 * @return $this
 */',
        'startLine' => 77,
        'endLine' => 82,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Illuminate\\Contracts\\Database',
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'currentClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'aliasName' => NULL,
      ),
      'getClass' => 
      array (
        'name' => 'getClass',
        'parameters' => 
        array (
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionUnionType',
          'data' => 
          array (
            'types' => 
            array (
              0 => 
              array (
                'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
                'data' => 
                array (
                  'name' => 'string',
                  'isIdentifier' => true,
                ),
              ),
              1 => 
              array (
                'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
                'data' => 
                array (
                  'name' => 'null',
                  'isIdentifier' => true,
                ),
              ),
            ),
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * Get the fully-qualified class name of the Model.
 *
 * @return class-string<\\Illuminate\\Database\\Eloquent\\Model>|null
 */',
        'startLine' => 89,
        'endLine' => 96,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Illuminate\\Contracts\\Database',
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'currentClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'aliasName' => NULL,
      ),
      'useMorphMap' => 
      array (
        'name' => 'useMorphMap',
        'parameters' => 
        array (
          'useMorphMap' => 
          array (
            'name' => 'useMorphMap',
            'default' => 
            array (
              'code' => 'true',
              'attributes' => 
              array (
                'startLine' => 101,
                'endLine' => 101,
                'startTokenPos' => 275,
                'startFilePos' => 2467,
                'endTokenPos' => 275,
                'endFilePos' => 2470,
              ),
            ),
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'bool',
                'isIdentifier' => true,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 101,
            'endLine' => 101,
            'startColumn' => 40,
            'endColumn' => 63,
            'parameterIndex' => 0,
            'isOptional' => true,
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
        'docComment' => '/**
 * Indicate whether to use the relational morph-map when serializing Models.
 */',
        'startLine' => 101,
        'endLine' => 104,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 17,
        'namespace' => 'Illuminate\\Contracts\\Database',
        'declaringClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'implementingClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
        'currentClassName' => 'Illuminate\\Contracts\\Database\\ModelIdentifier',
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