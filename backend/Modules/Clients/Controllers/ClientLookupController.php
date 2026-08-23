<?php

namespace Modules\Clients\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Clients\Models\Company;

/**
 * Is this company already on Kangaru? (ADR-0060 §3.)
 *
 * ## It answers a boolean, and that is the entire specification
 *
 * No name. No address. No contact. No status. No count. **No indication of
 * which fleet, or how many fleets, serve them.**
 *
 * A fleet onboarding a client asks this before anything else, because the
 * alternative — finding out at save time — is the moment when the pressure to
 * work around the check is highest and the easiest workaround is a slightly
 * different spelling of the name.
 *
 * But *"is Centenary on Kangaru?"* is not a question one fleet may ask about
 * another fleet's client. A lookup that leaked so much as the legal name
 * would turn the onboarding form into a competitor-intelligence tool, and it
 * would do it while looking like a helpful confirmation. So the response body
 * carries one key, and the test that asserts nothing else is in it is the
 * real deliverable here.
 *
 * ## Exact match only
 *
 * No search, no prefix, no listing. A registration number is issued by the
 * state and is not guessable in the space of a rate limit — and a fleet that
 * holds a client's number learned it from that client. Fuzzy matching on the
 * name was rejected in ADR-0060's Context: it produces either false
 * positives, which block a genuinely new client, or false negatives, which
 * are the duplicate this whole decision exists to prevent.
 */
class ClientLookupController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'registration_number' => ['required', 'string', 'max:100'],
        ]);

        // `withoutGlobalScopes` deliberately. The client scope would narrow
        // this to the caller's own client — which for a fleet's staff is
        // none — and the question is precisely about rows they may not read.
        // That is safe *because* the answer is a boolean: the caller learns
        // whether a number is taken and nothing whatever about whose it is.
        $exists = Company::withoutGlobalScopes()
            ->where('registration_number', $validated['registration_number'])
            ->exists();

        return ApiResponse::success(['exists' => $exists]);
    }
}
