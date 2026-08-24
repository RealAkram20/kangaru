<?php

namespace Modules\Administration\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Models\Setting;
use Modules\Administration\Services\MailDnsCheck;

/**
 * The DNS records email needs, and whether they are actually there.
 *
 * ## Why this is on the settings screen and not in a document
 *
 * It was in a document first (`docs/mail-dns.md`), and the owner's objection
 * was the right one: *"it's not that every day I have to ask you if I happen
 * to change the email server."* A record you have to go and find in a repo is
 * a record you ask somebody about.
 *
 * This is the screen you are already on when you configure SMTP, so it is
 * where the DNS half belongs. The document stays for the provider-migration
 * case, which is longer than a panel should be.
 *
 * ## It shows one record and checks two, and that asymmetry is deliberate
 *
 * `docs/screen-rules.md` §1: never invent a value.
 *
 * - **DMARC is derivable.** The name is always `_dmarc` and the policy is the
 *   platform's own choice; the only variable is the reporting address, which
 *   is the configured from-address. So the screen can offer the whole record
 *   to copy, and does.
 * - **SPF and DKIM are not.** The SPF `include:` and the DKIM selector come
 *   from the email provider and nothing here can know them. Titan's are not
 *   Gmail's. So the screen reports **whether they exist** — which is a real
 *   lookup against real DNS — and refuses to guess their contents.
 *
 * A panel that printed a plausible SPF line for an unknown provider would be
 * the worst outcome available: it would look authoritative and it would break
 * mail for the domain that pasted it.
 */
class MailDnsController extends Controller
{
    public function __construct(private readonly MailDnsCheck $dns) {}

    public function show(): JsonResponse
    {
        // The same gate as the SMTP settings beside it (ADR-0014 §4): reading
        // is held as tightly as writing, because the panel names the sending
        // domain and what is missing from its defences.
        $this->authorize('viewAny', Setting::class);

        return ApiResponse::success($this->dns->inspect());
    }
}
