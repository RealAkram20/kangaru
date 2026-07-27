<?php

namespace App\Support\Api;

use App\Enums\ErrorCode;
use Illuminate\Http\JsonResponse;

/**
 * Builds the response envelope defined in AGENTS.md API Standards.
 * Success: {success, message, data}. Failure: {success, code, message, errors}.
 */
class ApiResponse
{
    public static function success(mixed $data = null, string $message = '', int $status = 200): JsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => $message,
            'data' => $data,
        ], $status);
    }

    /**
     * @param  array<string, mixed>  $errors
     */
    public static function error(ErrorCode $code, string $message, array $errors = [], int $status = 422): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => $code->value,
            'message' => $message,
            'errors' => $errors,
        ], $status);
    }
}
