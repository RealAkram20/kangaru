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
    /**
     * @param  array<string, mixed>|null  $meta  e.g. {"cursor": {"next": "..."}} for cursor-paginated
     *                                           endpoints (AGENTS.md API Standards §Pagination). Omitted from the envelope when null so
     *                                           existing callers' response bodies are unchanged.
     */
    public static function success(mixed $data = null, string $message = '', int $status = 200, ?array $meta = null): JsonResponse
    {
        $envelope = [
            'success' => true,
            'message' => $message,
            'data' => $data,
        ];

        if ($meta !== null) {
            $envelope['meta'] = $meta;
        }

        return response()->json($envelope, $status);
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
