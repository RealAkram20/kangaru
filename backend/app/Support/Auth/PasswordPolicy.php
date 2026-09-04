<?php

namespace App\Support\Auth;

use Illuminate\Validation\Rules\Password;

/**
 * The platform's password floor, in one place.
 *
 * **This class exists because the number used to live in eight places and
 * disagreed with itself in three of them.** Before it, the office minted staff
 * accounts and driver sign-ins at twelve characters, the invite, reset,
 * change-own-password and driver-application doors accepted eight, the customer
 * register used a plain `min:8` string rule, and `CreateKangaruStaff` called
 * `Password::defaults()` — which nothing configured, so it silently meant
 * Laravel's own eight.
 *
 * That spread was not a policy, it was an accident, and it had already produced
 * two user-visible lies: `ProfilePage` told staff "At least 12 characters" for a
 * door that accepted eight, and the driver sign-in dialog set a password at
 * twelve while telling the office to *"ask them to change it from their own
 * profile afterwards"* — sending a driver to a door with a different rule than
 * the one they had just been handed.
 *
 * A floor that differs by door is not a stricter platform. It is a platform
 * where nobody can state the rule, which is the condition under which a hint
 * goes stale without anyone noticing.
 *
 * ## Why six, and why that is not a weakening in the way it looks
 *
 * Set by the owner on 24 August 2026, deliberately and for every door, after
 * being shown the spread above and asked the two questions separately (all
 * doors or some; staff too or not). Recorded here rather than only in the
 * worklog because the next person to read `Password::min(6)` will want to know
 * whether it was chosen or inherited.
 *
 * The reasoning that makes it defensible:
 *
 * - **Length is a floor, not the control.** Nothing above this number is
 *   enforced anywhere in the platform and nothing ever was — there is no
 *   complexity rule at any door. Twelve characters of `aaaaaaaaaaaa` passed
 *   every check the old rule made. The strength meter, which both apps now
 *   render, is what actually teaches; it keeps asking long after six.
 * - **The accounts that matter carry a second factor.** Finance and Super Admin
 *   are MFA-gated; the length of their first factor is not the thing standing
 *   between an attacker and the money.
 * - **The login endpoint is throttled**, so the offline-guessing model that
 *   makes twelve meaningful is not the model this floor is defending against.
 *
 * If that trade is ever revisited, it is revisited **here**, once, and every
 * door moves together. That is the entire point of the class.
 */
final class PasswordPolicy
{
    /**
     * The fewest characters any password on this platform may have.
     *
     * Referenced by the web app's `MIN_PASSWORD_LENGTH` and the driver app's
     * `MINIMUM_PASSWORD_LENGTH`, both of which restate it because the three
     * packages cannot import from one another. Those two are pinned by tests
     * that read this number's *effect* through the API, not by trust.
     */
    public const MINIMUM_LENGTH = 6;

    /**
     * The rule every password field validates against.
     *
     * A method rather than a bare constant at each call site, so that adding a
     * platform-wide requirement later — an uncompromised check, a complexity
     * step — lands at every door at once instead of at the seven somebody
     * remembers.
     *
     * Not `Password::defaults()`: that reads a closure registered in a service
     * provider, and if the registration is ever dropped the rule silently
     * becomes Laravel's built-in eight rather than failing. A floor that
     * changes when a line is deleted is a floor that can move without a diff
     * that mentions it.
     */
    public static function rule(): Password
    {
        return Password::min(self::MINIMUM_LENGTH);
    }
}
