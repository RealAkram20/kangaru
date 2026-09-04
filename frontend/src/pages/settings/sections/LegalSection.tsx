import { Textarea } from '../../../components/forms/Textarea'
import { SectionForm, StackedRow } from '../kit'
import { useSectionState } from '../state'
import type { SectionProps } from '../types'

/**
 * The two notices a driver consents to (ADR-0014, `legal` group).
 *
 * These live in settings rather than in a marketing page because of who has to
 * be able to change them and how fast: a wrong privacy notice is a regulatory
 * problem under the Data Protection and Privacy Act, 2019, and waiting for a
 * release to correct one is not an answer. Saving here changes what the next
 * driver reads, immediately.
 *
 * Both rows are stacked rather than split: a label column beside a fourteen-row
 * textarea wastes the width these two fields are the only ones on the page to
 * actually want.
 */
export function LegalSection({ settings, onSaved, section }: SectionProps) {
  const state = useSectionState({
    terms: settings.legal.terms ?? '',
    privacy: settings.legal.privacy ?? '',
  })
  const { value, set } = state

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      payload={() => ({ terms: value.terms, privacy: value.privacy })}
    >
      {(errors) => (
        <>
          <StackedRow
            label="Terms and Conditions"
            htmlFor="settings-terms"
            error={errors.terms}
          >
            <Textarea
              id="settings-terms"
              rows={14}
              value={value.terms}
              invalid={errors.terms !== undefined}
              onChange={(event) => set('terms', event.target.value)}
            />
          </StackedRow>

          <StackedRow
            label="Privacy Policy"
            htmlFor="settings-privacy"
            hint="Required by the Data Protection and Privacy Act, 2019."
            error={errors.privacy}
          >
            <Textarea
              id="settings-privacy"
              rows={14}
              value={value.privacy}
              invalid={errors.privacy !== undefined}
              onChange={(event) => set('privacy', event.target.value)}
            />
          </StackedRow>
        </>
      )}
    </SectionForm>
  )
}
