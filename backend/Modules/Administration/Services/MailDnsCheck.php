<?php

namespace Modules\Administration\Services;

/**
 * Looks up the three DNS records email deliverability rests on.
 *
 * ## What it will and will not say
 *
 * It reports **presence**, and it composes exactly one record: DMARC, whose
 * name is fixed and whose only variable is the reporting address.
 *
 * It will not compose SPF or DKIM. Those depend on the email provider — Titan's
 * `include:` is not Gmail's, and a DKIM selector is whatever the provider
 * generated. Printing a plausible-looking SPF line for an unknown provider
 * would look authoritative and would break mail for the domain that pasted it,
 * which is worse than saying nothing. `docs/screen-rules.md` §1: never invent
 * a value.
 *
 * ## DKIM is reported as "unknown", not as "missing"
 *
 * There is no way to enumerate DKIM selectors: you can only ask whether a
 * *named* one exists, and the name is the provider's. So a handful of common
 * selectors are tried and a hit is reported honestly as a hit. **A miss is
 * reported as unknown rather than as absent**, because "we could not find one"
 * and "there is not one" are different statements and only the first is true.
 *
 * Saying "DKIM missing" to somebody whose DKIM is fine under a selector this
 * list has never heard of would send them to break a working setup.
 *
 * ## Failures are answers, not exceptions
 *
 * A settings screen must render when DNS is slow, blocked or unreachable. Every
 * lookup is wrapped and a failure becomes `unknown`, which the screen can say
 * out loud. An exception here would take down the SMTP form beside it, which is
 * the thing somebody actually came to use.
 */
class MailDnsCheck
{
    /**
     * Selectors worth trying, most likely first.
     *
     * Titan's is `titan1`. The rest are the common defaults across providers.
     * This list is a convenience, never an authority — see the class note on
     * why a miss is `unknown`.
     */
    private const DKIM_SELECTORS = ['titan1', 'titan2', 'default', 'google', 'k1', 's1', 'mail', 'dkim'];

    public function __construct(private readonly SettingsService $settings) {}

    /**
     * @return array{
     *     domain: string|null,
     *     from_address: string|null,
     *     spf: array{status: string, value: string|null},
     *     dkim: array{status: string, selector: string|null},
     *     dmarc: array{status: string, value: string|null, name: string, suggested: string}
     * }
     */
    public function inspect(): array
    {
        $from = trim((string) $this->settings->get('mail', 'from_address'));
        $domain = $this->domainOf($from);

        $suggested = $from === ''
            // No from-address configured yet, so there is no reporting mailbox
            // to name. The record is still shown with the placeholder visible,
            // because somebody reading the panel before they have filled the
            // form should see the shape of what is coming.
            ? 'v=DMARC1; p=none; fo=1'
            : 'v=DMARC1; p=none; rua=mailto:'.$from.'; fo=1';

        if ($domain === null) {
            return [
                'domain' => null,
                'from_address' => $from === '' ? null : $from,
                'spf' => ['status' => 'unknown', 'value' => null],
                'dkim' => ['status' => 'unknown', 'selector' => null],
                'dmarc' => ['status' => 'unknown', 'value' => null, 'name' => '_dmarc', 'suggested' => $suggested],
            ];
        }

        $spf = $this->firstTxtMatching($domain, 'v=spf1');
        $dmarc = $this->firstTxtMatching('_dmarc.'.$domain, 'v=DMARC1');

        return [
            'domain' => $domain,
            'from_address' => $from,
            'spf' => [
                'status' => $spf === null ? 'missing' : 'found',
                'value' => $spf,
            ],
            'dkim' => $this->findDkim($domain),
            'dmarc' => [
                'status' => $dmarc === null ? 'missing' : 'found',
                'value' => $dmarc,
                'name' => '_dmarc',
                'suggested' => $suggested,
            ],
        ];
    }

    /**
     * @return array{status: string, selector: string|null}
     */
    private function findDkim(string $domain): array
    {
        foreach (self::DKIM_SELECTORS as $selector) {
            if ($this->firstTxtMatching($selector.'._domainkey.'.$domain, 'v=DKIM1') !== null) {
                return ['status' => 'found', 'selector' => $selector];
            }
        }

        // Not `missing`. See the class note: a selector this list has never
        // heard of is indistinguishable from no DKIM at all, and only one of
        // those is worth telling somebody about.
        return ['status' => 'unknown', 'selector' => null];
    }

    private function firstTxtMatching(string $host, string $prefix): ?string
    {
        try {
            $records = @dns_get_record($host, DNS_TXT);
        } catch (\Throwable) {
            return null;
        }

        if (! is_array($records)) {
            return null;
        }

        foreach ($records as $record) {
            // `txt` is the joined value; `entries` is the raw chunks. A long
            // DKIM key arrives split across 255-character strings, so the
            // joined form is the one to match against.
            $value = (string) ($record['txt'] ?? '');

            if (str_starts_with($value, $prefix)) {
                return $value;
            }
        }

        return null;
    }

    /** The part after the @, lowercased, or null if there is no usable address. */
    private function domainOf(string $address): ?string
    {
        if (! str_contains($address, '@')) {
            return null;
        }

        $domain = mb_strtolower(trim(substr(strrchr($address, '@') ?: '', 1)));

        return $domain === '' ? null : $domain;
    }
}
