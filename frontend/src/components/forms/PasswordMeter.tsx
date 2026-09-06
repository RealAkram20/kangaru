import { Icon } from '../core/Icon'
import {
  passwordStrength,
  STRENGTH_SEGMENTS,
  type PasswordStrength,
} from '../../auth/passwordStrength'

/**
 * Four segments, a word, the scale in the open, and one piece of advice.
 *
 * **The console had no meter at all.** One existed inside `OrderPage` — the
 * public customer sign-up, Tailwind-skinned and not exported — and one in the
 * driver app. Every password field a member of staff ever typed into had
 * neither: the driver sign-in dialog, the staff form, the invite page and the
 * profile screen all offered a box, a length rule, and no way to tell whether
 * what you had typed was any good. The owner asked for *"a strength helper as
 * we have it in our mobile app"*, and this is that, in this app's vocabulary.
 *
 * Not shared with `OrderPage`'s: that one is Tailwind on the public marketing
 * bundle, this one is tokens and `FormField` in the console. Same scorer,
 * which is the part that carries the judgement; different skin, which is the
 * part that carries nothing.
 *
 * **The word is not decoration.** `docs/screen-rules.md` §6 forbids meaning
 * carried by colour alone, and a bar running red to green with no label is
 * exactly that.
 *
 * Renders nothing for an empty field: a meter reading "Too short" against a
 * box nobody has typed in yet is a scolding, not a guide. That is also why
 * these fields carry no `hint` — the checklist states the rule the moment
 * there is anything to state it about, and a hint saying "At least 6
 * characters" above a tick-box saying "6 characters or more" is the rule
 * twice (`docs/screen-rules.md` §9).
 */
export function PasswordMeter({ password }: { password: string }) {
  const strength = passwordStrength(password)

  if (password === '') return null

  const fill = fillFor(strength)

  return (
    /*
     * No margin of its own. Callers wrap the field and the meter in a tight
     * `grid` so the meter sits under the box it describes rather than floating
     * between that box and the next one — a form's own `gap` is tuned to
     * separate *fields*, and inheriting it here would put the meter closer to
     * the field below than to the one it grades.
     */
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flex: 1, gap: 'var(--space-1)' }} aria-hidden>
          {Array.from({ length: STRENGTH_SEGMENTS }, (_, segment) => (
            <span
              key={segment}
              style={{
                height: 4,
                flex: 1,
                borderRadius: 'var(--radius-pill)',
                background: segment < strength.score ? fill : 'var(--surface-sunken)',
                // Colour only, and only on a surface nobody is reading — the
                // segment is `aria-hidden` and the word beside it carries the
                // meaning. DESIGN.md §7's rule about high-frequency icons is
                // about icons; this is a 150ms tint on a bar that exists to be
                // watched while typing.
                transition: 'var(--transition-control)',
              }}
            />
          ))}
        </div>

        {/*
          The bar is hidden from the screen reader and this carries it, so it
          says the count as well as the word — "2 of 4" is what a sighted user
          can see and a blind one otherwise could not.
        */}
        <span
          style={{
            font: 'var(--type-caption)',
            fontWeight: 'var(--weight-medium)',
            color: fill,
            width: 56,
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          <span className="sr-only">
            {`Password strength: ${strength.label}, ${strength.score} of ${STRENGTH_SEGMENTS}. `}
          </span>
          <span aria-hidden>{strength.label}</span>
        </span>
      </div>

      {/*
        The scale, in the open. A bar with a hidden standard grades against a
        rule nobody stated — which is how a password holding a capital, a
        number and a symbol at the minimum length came to read "Fair" and be
        asked for four more characters, with no way to learn what the last two
        segments wanted.
      */}
      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: 'var(--space-4)',
          rowGap: 'var(--space-1)',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {strength.requirements.map((requirement) => (
          <Requirement key={requirement.key} label={requirement.label} met={requirement.met} />
        ))}
      </ul>

      {/*
        `polite`, never assertive: this changes on every keystroke, and an
        assertive region would interrupt the typing it is describing.
      */}
      {strength.hint !== null && (
        <p
          style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', margin: 0 }}
          aria-live="polite"
        >
          {strength.hint}
        </p>
      )}
    </div>
  )
}

/**
 * One rule, and whether it is met.
 *
 * **The words carry it, never the tick alone.** `docs/screen-rules.md` §6: a
 * row of green and grey glyphs is meaning in colour, so the announcement says
 * "Met" or "Not yet" in as many words and the glyph is `aria-hidden`.
 */
function Requirement({ label, met }: { label: string; met: boolean }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
      <span className="sr-only">{met ? 'Met: ' : 'Not yet: '}</span>
      {met ? (
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--kr-success)',
            color: 'var(--surface-card)',
            flexShrink: 0,
          }}
        >
          <Icon name="check" size={10} strokeWidth={3} />
        </span>
      ) : (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: 'var(--radius-pill)',
            // A ring, not a filled circle: an unmet rule is an outline waiting
            // to be completed, and a solid grey dot reads as a bullet point.
            border: '1.5px solid var(--border-default)',
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          font: 'var(--type-caption)',
          color: met ? 'var(--text-body)' : 'var(--text-secondary)',
        }}
      >
        {label}
      </span>
    </li>
  )
}

/**
 * Tokens only — DESIGN.md §8 fails a raw hex at a call site.
 *
 * `--kr-warning` carries both the weak and fair steps rather than introducing
 * a second amber: the palette has one, and a meter is not a reason to invent a
 * colour that then has to hold up in the dark theme as well.
 */
function fillFor(strength: PasswordStrength): string {
  if (strength.level === 'strong') return 'var(--kr-success)'
  if (strength.level === 'good') return 'var(--action-primary)'
  if (strength.level === 'fair') return 'var(--kr-warning)'

  return 'var(--kr-error)'
}
