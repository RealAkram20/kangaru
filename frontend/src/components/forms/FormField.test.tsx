import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormField } from './FormField'
import { Input } from './Input'

/**
 * FormField wraps nearly every input in the product, so what it puts in a
 * label is what a screen reader says on nearly every form.
 *
 * The bug these pin: the required asterisk sat inside the `<label>` with
 * nothing marking it decorative, so the accessible name of the booking
 * form's passenger field was "Passenger *" and was read aloud as
 * "Passenger star".
 */
describe('FormField', () => {
  it('does not read the required asterisk out as part of the field name', () => {
    render(
      <FormField label="Passenger" htmlFor="passenger" required>
        <Input id="passenger" />
      </FormField>,
    )

    const field = screen.getByLabelText(/^passenger/i)

    // The asterisk is a sighted convention. It must not survive into the
    // accessible name, and the word it stands for must.
    expect(field).toHaveAccessibleName('Passenger (required)')
    expect(field).not.toHaveAccessibleName(expect.stringContaining('*'))
  })

  it('still shows the asterisk on screen', () => {
    const { container } = render(
      <FormField label="Passenger" htmlFor="passenger" required>
        <Input id="passenger" />
      </FormField>,
    )

    // Hiding it from assistive tech must not mean removing it — it is how
    // a sighted user tells a required field from an optional one.
    const marker = container.querySelector('[aria-hidden="true"]')
    expect(marker).not.toBeNull()
    expect(marker?.textContent).toBe('*')
  })

  it('says nothing about being required when it is not', () => {
    render(
      <FormField label="Contact number" htmlFor="contact">
        <Input id="contact" />
      </FormField>,
    )

    expect(screen.getByLabelText('Contact number')).toHaveAccessibleName('Contact number')
  })

  it('replaces the hint with the error, so a field never shows both', () => {
    const { rerender } = render(
      <FormField label="Amount" htmlFor="amount" hint="Whole shillings.">
        <Input id="amount" />
      </FormField>,
    )

    expect(screen.getByText('Whole shillings.')).toBeInTheDocument()

    rerender(
      <FormField
        label="Amount"
        htmlFor="amount"
        hint="Whole shillings."
        error="Amount is required."
      >
        <Input id="amount" />
      </FormField>,
    )

    // Guidance the user has already failed to follow competes with the
    // reason they failed; the error is the one that has to be read.
    expect(screen.getByText('Amount is required.')).toBeInTheDocument()
    expect(screen.queryByText('Whole shillings.')).toBeNull()
  })

  it('marks the control itself as required, not only the label', () => {
    render(
      <FormField label="Passenger" htmlFor="passenger" required>
        <Input id="passenger" />
      </FormField>,
    )

    // The label's "(required)" is only heard when the label is read. A
    // screen reader user tabbing straight into the field hears nothing
    // without this, and field-by-field is how forms are actually
    // navigated.
    expect(screen.getByLabelText(/passenger/i)).toHaveAttribute('aria-required', 'true')
  })

  it('leaves an optional control unmarked rather than saying required="false"', () => {
    render(
      <FormField label="Notes" htmlFor="notes">
        <Input id="notes" />
      </FormField>,
    )

    expect(screen.getByLabelText(/notes/i)).not.toHaveAttribute('aria-required')
  })

  it('points the control at its error text, and marks it invalid', () => {
    render(
      <FormField label="Amount" htmlFor="amount" error="Amount is required.">
        <Input id="amount" />
      </FormField>,
    )

    const input = screen.getByLabelText(/amount/i)

    expect(input).toHaveAttribute('aria-invalid', 'true')

    // Without the association the error is on screen and unreachable: a
    // screen reader announces the field, says nothing about why it was
    // rejected, and the user is left tabbing for a message they cannot
    // find.
    expect(input).toHaveAccessibleDescription('Amount is required.')
  })

  it('associates a hint the same way when there is no error', () => {
    render(
      <FormField label="Amount" htmlFor="amount" hint="Whole shillings.">
        <Input id="amount" />
      </FormField>,
    )

    expect(screen.getByLabelText(/amount/i)).toHaveAccessibleDescription('Whole shillings.')
  })

  it('does not overrule a caller that set the ARIA itself', () => {
    render(
      <FormField label="Passenger" htmlFor="passenger" required>
        <Input id="passenger" aria-required={false} />
      </FormField>,
    )

    // A caller with a reason to differ wins. Cloning is a convenience, not
    // a policy the component enforces over its callers.
    expect(screen.getByLabelText(/passenger/i)).toHaveAttribute('aria-required', 'false')
  })

  it('renders unharmed when it wraps something other than one element', () => {
    // Children.only throws for zero or several. The field must still
    // render — degrading to "no annotation" is fine, blowing up the page
    // to add an ARIA attribute is not.
    render(
      <FormField label="Range" required>
        <Input id="from" />
        <Input id="to" />
      </FormField>,
    )

    expect(screen.getByText('Range')).toBeInTheDocument()
  })
})
