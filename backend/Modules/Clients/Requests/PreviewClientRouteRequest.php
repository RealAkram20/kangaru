<?php

namespace Modules\Clients\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Drawing the circuit a client is still dragging into shape (ADR-0045 §7).
 *
 * ## Why this is a POST for what is plainly a read
 *
 * AGENTS.md commits to GET for reads, and this breaks that on purpose: the
 * thing being drawn is a **draft**, so there is no id to GET. Twenty-five
 * place ids in a query string is a URL near the length proxies start
 * truncating, and a truncated list draws a shorter circuit rather than
 * failing — the worst of the available failures.
 *
 * Nothing is created and nothing is stored; the answer is cached by
 * `RouteService` on the points themselves, so a client dragging one stop
 * back and forth is billed once.
 */
class PreviewClientRouteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Two is the floor because one point is not a journey. The
            // ceiling is the route's own, for the reason
            // `StoreClientRouteRequest` gives: it is what the provider draws.
            'place_ids' => ['required', 'array', 'min:2', 'max:'.StoreClientRouteRequest::MAX_STOPS],
            'place_ids.*' => ['required', 'integer', 'exists:client_places,id'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'place_ids.min' => 'A route needs at least two stops before it can be drawn.',
        ];
    }
}
