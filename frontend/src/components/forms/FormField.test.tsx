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
})
