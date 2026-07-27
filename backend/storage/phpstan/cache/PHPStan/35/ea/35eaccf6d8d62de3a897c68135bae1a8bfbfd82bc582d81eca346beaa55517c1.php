<?php declare(strict_types = 1);

// osfsl-C:/xampp/htdocs/Kangaru/backend/vendor/composer/../monolog/monolog/src/Monolog/Formatter/JsonFormatter.php-PHPStan\BetterReflection\Reflection\ReflectionClass-Monolog\Formatter\JsonFormatter
return \PHPStan\Cache\CacheItem::__set_state(array(
   'variableKey' => 'v2-cbdc47613c47761f199efad4a948320c17316147673359f7771baf23b02adebe-8.3.32-6.70.0.3',
   'data' => 
  array (
    'locatedSource' => 
    array (
      'class' => 'PHPStan\\BetterReflection\\SourceLocator\\Located\\LocatedSource',
      'data' => 
      array (
        'name' => 'Monolog\\Formatter\\JsonFormatter',
        'filename' => 'C:/xampp/htdocs/Kangaru/backend/vendor/composer/../monolog/monolog/src/Monolog/Formatter/JsonFormatter.php',
      ),
    ),
    'namespace' => 'Monolog\\Formatter',
    'name' => 'Monolog\\Formatter\\JsonFormatter',
    'shortName' => 'JsonFormatter',
    'isInterface' => false,
    'isTrait' => false,
    'isEnum' => false,
    'isBackedEnum' => false,
    'modifiers' => 0,
    'docComment' => '/**
 * Encodes whatever record data is passed to it as json
 *
 * This can be useful to log to databases or remote APIs
 *
 * @author Jordi Boggiano <j.boggiano@seld.be>
 */',
    'attributes' => 
    array (
    ),
    'startLine' => 25,
    'endLine' => 234,
    'startColumn' => 1,
    'endColumn' => 1,
    'parentClassName' => 'Monolog\\Formatter\\NormalizerFormatter',
    'implementsClassNames' => 
    array (
    ),
    'traitClassNames' => 
    array (
    ),
    'immediateConstants' => 
    array (
      'BATCH_MODE_JSON' => 
      array (
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'name' => 'BATCH_MODE_JSON',
        'modifiers' => 1,
        'type' => NULL,
        'value' => 
        array (
          'code' => '1',
          'attributes' => 
          array (
            'startLine' => 27,
            'endLine' => 27,
            'startTokenPos' => 51,
            'startFilePos' => 605,
            'endTokenPos' => 51,
            'endFilePos' => 605,
          ),
        ),
        'docComment' => NULL,
        'attributes' => 
        array (
        ),
        'startLine' => 27,
        'endLine' => 27,
        'startColumn' => 5,
        'endColumn' => 37,
      ),
      'BATCH_MODE_NEWLINES' => 
      array (
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'name' => 'BATCH_MODE_NEWLINES',
        'modifiers' => 1,
        'type' => NULL,
        'value' => 
        array (
          'code' => '2',
          'attributes' => 
          array (
            'startLine' => 28,
            'endLine' => 28,
            'startTokenPos' => 62,
            'startFilePos' => 647,
            'endTokenPos' => 62,
            'endFilePos' => 647,
          ),
        ),
        'docComment' => NULL,
        'attributes' => 
        array (
        ),
        'startLine' => 28,
        'endLine' => 28,
        'startColumn' => 5,
        'endColumn' => 41,
      ),
    ),
    'immediateProperties' => 
    array (
      'batchMode' => 
      array (
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'name' => 'batchMode',
        'modifiers' => 2,
        'type' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'int',
            'isIdentifier' => true,
          ),
        ),
        'default' => NULL,
        'docComment' => '/** @var self::BATCH_MODE_* */',
        'attributes' => 
        array (
        ),
        'startLine' => 31,
        'endLine' => 31,
        'startColumn' => 5,
        'endColumn' => 29,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'appendNewline' => 
      array (
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'name' => 'appendNewline',
        'modifiers' => 2,
        'type' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'bool',
            'isIdentifier' => true,
          ),
        ),
        'default' => NULL,
        'docComment' => NULL,
        'attributes' => 
        array (
        ),
        'startLine' => 33,
        'endLine' => 33,
        'startColumn' => 5,
        'endColumn' => 34,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'ignoreEmptyContextAndExtra' => 
      array (
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'name' => 'ignoreEmptyContextAndExtra',
        'modifiers' => 2,
        'type' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'bool',
            'isIdentifier' => true,
          ),
        ),
        'default' => NULL,
        'docComment' => NULL,
        'attributes' => 
        array (
        ),
        'startLine' => 35,
        'endLine' => 35,
        'startColumn' => 5,
        'endColumn' => 47,
        'isPromoted' => false,
        'declaredAtCompileTime' => true,
        'immediateVirtual' => false,
        'immediateHooks' => 
        array (
        ),
      ),
      'includeStacktraces' => 
      array (
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'name' => 'includeStacktraces',
        'modifiers' => 2,
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
            'startLine' => 37,
            'endLine' => 37,
            'startTokenPos' => 96,
            'startFilePos' => 843,
            'endTokenPos' => 96,
            'endFilePos' => 847,
          ),
        ),
        'docComment' => NULL,
        'attributes' => 
        array (
        ),
        'startLine' => 37,
        'endLine' => 37,
        'startColumn' => 5,
        'endColumn' => 47,
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
          'batchMode' => 
          array (
            'name' => 'batchMode',
            'default' => 
            array (
              'code' => 'self::BATCH_MODE_JSON',
              'attributes' => 
              array (
                'startLine' => 42,
                'endLine' => 42,
                'startTokenPos' => 113,
                'startFilePos' => 960,
                'endTokenPos' => 115,
                'endFilePos' => 980,
              ),
            ),
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'int',
                'isIdentifier' => true,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 42,
            'endLine' => 42,
            'startColumn' => 33,
            'endColumn' => 70,
            'parameterIndex' => 0,
            'isOptional' => true,
          ),
          'appendNewline' => 
          array (
            'name' => 'appendNewline',
            'default' => 
            array (
              'code' => 'true',
              'attributes' => 
              array (
                'startLine' => 42,
                'endLine' => 42,
                'startTokenPos' => 124,
                'startFilePos' => 1005,
                'endTokenPos' => 124,
                'endFilePos' => 1008,
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
            'startLine' => 42,
            'endLine' => 42,
            'startColumn' => 73,
            'endColumn' => 98,
            'parameterIndex' => 1,
            'isOptional' => true,
          ),
          'ignoreEmptyContextAndExtra' => 
          array (
            'name' => 'ignoreEmptyContextAndExtra',
            'default' => 
            array (
              'code' => 'false',
              'attributes' => 
              array (
                'startLine' => 42,
                'endLine' => 42,
                'startTokenPos' => 133,
                'startFilePos' => 1046,
                'endTokenPos' => 133,
                'endFilePos' => 1050,
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
            'startLine' => 42,
            'endLine' => 42,
            'startColumn' => 101,
            'endColumn' => 140,
            'parameterIndex' => 2,
            'isOptional' => true,
          ),
          'includeStacktraces' => 
          array (
            'name' => 'includeStacktraces',
            'default' => 
            array (
              'code' => 'false',
              'attributes' => 
              array (
                'startLine' => 42,
                'endLine' => 42,
                'startTokenPos' => 142,
                'startFilePos' => 1080,
                'endTokenPos' => 142,
                'endFilePos' => 1084,
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
            'startLine' => 42,
            'endLine' => 42,
            'startColumn' => 143,
            'endColumn' => 174,
            'parameterIndex' => 3,
            'isOptional' => true,
          ),
        ),
        'returnsReference' => false,
        'returnType' => NULL,
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * @param self::BATCH_MODE_* $batchMode
 */',
        'startLine' => 42,
        'endLine' => 50,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'getBatchMode' => 
      array (
        'name' => 'getBatchMode',
        'parameters' => 
        array (
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'int',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * The batch mode option configures the formatting style for
 * multiple records. By default, multiple records will be
 * formatted as a JSON-encoded array. However, for
 * compatibility with some API endpoints, alternative styles
 * are available.
 */',
        'startLine' => 59,
        'endLine' => 62,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'isAppendingNewlines' => 
      array (
        'name' => 'isAppendingNewlines',
        'parameters' => 
        array (
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'bool',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * True if newlines are appended to every formatted record
 */',
        'startLine' => 67,
        'endLine' => 70,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'format' => 
      array (
        'name' => 'format',
        'parameters' => 
        array (
          'record' => 
          array (
            'name' => 'record',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'Monolog\\LogRecord',
                'isIdentifier' => false,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 75,
            'endLine' => 75,
            'startColumn' => 28,
            'endColumn' => 44,
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
            'name' => 'string',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * @inheritDoc
 */',
        'startLine' => 75,
        'endLine' => 80,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'formatBatch' => 
      array (
        'name' => 'formatBatch',
        'parameters' => 
        array (
          'records' => 
          array (
            'name' => 'records',
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
            'startLine' => 85,
            'endLine' => 85,
            'startColumn' => 33,
            'endColumn' => 46,
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
            'name' => 'string',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * @inheritDoc
 */',
        'startLine' => 85,
        'endLine' => 91,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'includeStacktraces' => 
      array (
        'name' => 'includeStacktraces',
        'parameters' => 
        array (
          'include' => 
          array (
            'name' => 'include',
            'default' => 
            array (
              'code' => 'true',
              'attributes' => 
              array (
                'startLine' => 96,
                'endLine' => 96,
                'startTokenPos' => 376,
                'startFilePos' => 2527,
                'endTokenPos' => 376,
                'endFilePos' => 2530,
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
            'startLine' => 96,
            'endLine' => 96,
            'startColumn' => 40,
            'endColumn' => 59,
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
            'name' => 'self',
            'isIdentifier' => false,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * @return $this
 */',
        'startLine' => 96,
        'endLine' => 101,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 1,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'normalizeRecord' => 
      array (
        'name' => 'normalizeRecord',
        'parameters' => 
        array (
          'record' => 
          array (
            'name' => 'record',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'Monolog\\LogRecord',
                'isIdentifier' => false,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 106,
            'endLine' => 106,
            'startColumn' => 40,
            'endColumn' => 56,
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
            'name' => 'array',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * @return array<array<mixed>|bool|float|int|\\stdClass|string|null>
 */',
        'startLine' => 106,
        'endLine' => 126,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 2,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'formatBatchJson' => 
      array (
        'name' => 'formatBatchJson',
        'parameters' => 
        array (
          'records' => 
          array (
            'name' => 'records',
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
            'startLine' => 133,
            'endLine' => 133,
            'startColumn' => 40,
            'endColumn' => 53,
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
            'name' => 'string',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * Return a JSON-encoded array of records.
 *
 * @phpstan-param LogRecord[] $records
 */',
        'startLine' => 133,
        'endLine' => 138,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 2,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'formatBatchNewlines' => 
      array (
        'name' => 'formatBatchNewlines',
        'parameters' => 
        array (
          'records' => 
          array (
            'name' => 'records',
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
            'startLine' => 146,
            'endLine' => 146,
            'startColumn' => 44,
            'endColumn' => 57,
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
            'name' => 'string',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * Use new lines to separate records instead of a
 * JSON-encoded array.
 *
 * @phpstan-param LogRecord[] $records
 */',
        'startLine' => 146,
        'endLine' => 154,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 2,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'normalize' => 
      array (
        'name' => 'normalize',
        'parameters' => 
        array (
          'data' => 
          array (
            'name' => 'data',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'mixed',
                'isIdentifier' => true,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 161,
            'endLine' => 161,
            'startColumn' => 34,
            'endColumn' => 44,
            'parameterIndex' => 0,
            'isOptional' => false,
          ),
          'depth' => 
          array (
            'name' => 'depth',
            'default' => 
            array (
              'code' => '0',
              'attributes' => 
              array (
                'startLine' => 161,
                'endLine' => 161,
                'startTokenPos' => 737,
                'startFilePos' => 4431,
                'endTokenPos' => 737,
                'endFilePos' => 4431,
              ),
            ),
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'int',
                'isIdentifier' => true,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 161,
            'endLine' => 161,
            'startColumn' => 47,
            'endColumn' => 60,
            'parameterIndex' => 1,
            'isOptional' => true,
          ),
        ),
        'returnsReference' => false,
        'returnType' => 
        array (
          'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
          'data' => 
          array (
            'name' => 'mixed',
            'isIdentifier' => true,
          ),
        ),
        'attributes' => 
        array (
        ),
        'docComment' => '/**
 * Normalizes given $data.
 *
 * @return null|scalar|array<mixed[]|scalar|null|object>|object
 */',
        'startLine' => 161,
        'endLine' => 217,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 2,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'aliasName' => NULL,
      ),
      'normalizeException' => 
      array (
        'name' => 'normalizeException',
        'parameters' => 
        array (
          'e' => 
          array (
            'name' => 'e',
            'default' => NULL,
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'Throwable',
                'isIdentifier' => false,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 225,
            'endLine' => 225,
            'startColumn' => 43,
            'endColumn' => 54,
            'parameterIndex' => 0,
            'isOptional' => false,
          ),
          'depth' => 
          array (
            'name' => 'depth',
            'default' => 
            array (
              'code' => '0',
              'attributes' => 
              array (
                'startLine' => 225,
                'endLine' => 225,
                'startTokenPos' => 1100,
                'startFilePos' => 6413,
                'endTokenPos' => 1100,
                'endFilePos' => 6413,
              ),
            ),
            'type' => 
            array (
              'class' => 'PHPStan\\BetterReflection\\Reflection\\ReflectionNamedType',
              'data' => 
              array (
                'name' => 'int',
                'isIdentifier' => true,
              ),
            ),
            'isVariadic' => false,
            'byRef' => false,
            'isPromoted' => false,
            'attributes' => 
            array (
            ),
            'startLine' => 225,
            'endLine' => 225,
            'startColumn' => 57,
            'endColumn' => 70,
            'parameterIndex' => 1,
            'isOptional' => true,
          ),
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
        'docComment' => '/**
 * Normalizes given exception with or without its own stack trace based on
 * `includeStacktraces` property.
 *
 * @return array<array-key, string|int|array<string|int|array<string>>>
 */',
        'startLine' => 225,
        'endLine' => 233,
        'startColumn' => 5,
        'endColumn' => 5,
        'couldThrow' => false,
        'isClosure' => false,
        'isGenerator' => false,
        'isVariadic' => false,
        'modifiers' => 2,
        'namespace' => 'Monolog\\Formatter',
        'declaringClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'implementingClassName' => 'Monolog\\Formatter\\JsonFormatter',
        'currentClassName' => 'Monolog\\Formatter\\JsonFormatter',
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