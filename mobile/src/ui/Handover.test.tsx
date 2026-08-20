import { render } from '@testing-library/react-native';

import { Handover } from './Handover';

/**
 * That the hand-over says what it is doing, and says it to everybody.
 *
 * The timing lives in `trips/handover.test.ts`; this is about the surface —
 * and the two rules it has to keep are `docs/screen-rules.md` §1 (no figure
 * the platform cannot produce, and a duration is a figure) and §6 (one
 * sensible announcement, and never meaning by position alone).
 */

it('says what is happening, and where', async () => {
  const { getByText } = await render(
    <Handover label="Finding the road to the pickup" caption="Acacia Mall" step={1} total={2} />,
  );

  expect(getByText('Finding the road to the pickup')).toBeTruthy();
  expect(getByText('Acacia Mall')).toBeTruthy();
});

it('shows no caption before the platform knows one', async () => {
  // The opening step: the trip has not landed, so there is no address and no
  // passenger. An em dash would be worse than nothing here — there is no field
  // for it to be the value of.
  const { queryByText } = await render(
    <Handover label="Connecting to the passenger" caption={null} step={0} total={2} />,
  );

  expect(queryByText('Acacia Mall')).toBeNull();
});

it('promises no duration, anywhere', async () => {
  // ADR-0020 §3 and ADR-0031 §6. A progress bar that fills at a rate somebody
  // chose is the same invented figure in a friendlier shape, which is why the
  // rail is a count of steps and not a percentage.
  const { queryByText } = await render(
    <Handover label="Finding the road to the pickup" caption="Acacia Mall" step={1} total={2} />,
  );

  expect(queryByText(/\bmin(ute)?s?\b|\bsec/i)).toBeNull();
  expect(queryByText(/%|almost|nearly/i)).toBeNull();
});

it('announces itself as one sentence, with the step said in words', async () => {
  // A screen reader given the rail, the label and the caption separately reads
  // three fragments. And the rail is the only *visual* carrier of how far
  // through this is — §6 forbids leaving that to position alone.
  const { getByLabelText } = await render(
    <Handover label="Finding the road to the pickup" caption="Acacia Mall" step={1} total={2} />,
  );

  const surface = getByLabelText('Finding the road to the pickup. Acacia Mall');

  expect(surface.props.accessibilityValue).toEqual({ min: 1, max: 2, now: 2 });
  expect(surface.props.accessibilityRole).toBe('progressbar');
});

it('drops the caption from the announcement when there is none', async () => {
  const { getByLabelText } = await render(
    <Handover label="Connecting to the passenger" caption={null} step={0} total={2} />,
  );

  expect(getByLabelText('Connecting to the passenger')).toBeTruthy();
});

it('draws one bar per step, and fills as far as the job has got', async () => {
  const { getByLabelText } = await render(
    <Handover label="Switching to the passenger's route" caption={null} step={0} total={1} />,
  );

  // One step reads as "this is the only thing left", which at the arrival seam
  // is exactly true — the trip is already on the phone by then.
  expect(getByLabelText("Switching to the passenger's route").props.accessibilityValue).toEqual({
    min: 1,
    max: 1,
    now: 1,
  });
});
