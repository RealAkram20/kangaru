import { render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { Skeleton, SkeletonCards, SkeletonRows, SkeletonText } from './Skeleton';

/**
 * The loading placeholder that replaced seven bare spinners.
 *
 * Two properties are worth a test and the rest is styling:
 *
 * - **A screen reader hears "Loading" once**, not a dozen unlabelled views. A
 *   placeholder list is the easiest thing in this app to leave announcing
 *   nothing, because it looks right and reads as silence.
 * - **The pulse stops when the phone asks for reduced motion.**
 *   `docs/screen-rules.md` §5 requires respecting that setting, and a looping
 *   animation is exactly what it is set to stop.
 */

const reduceMotion = AccessibilityInfo.isReduceMotionEnabled as jest.Mock;

beforeEach(() => {
  reduceMotion.mockResolvedValue(false);
});

it('announces itself once, however many blocks it draws', async () => {
  const { getAllByLabelText, getByLabelText } = await render(<SkeletonRows count={5} />);

  // One announcement for the whole group, not one per row.
  expect(getAllByLabelText('Loading')).toHaveLength(1);
  expect(getByLabelText('Loading').props.accessibilityRole).toBe('progressbar');
});

it('draws a block per row it is asked for', async () => {
  const four = await render(<SkeletonRows count={4} />);
  const one = await render(<SkeletonRows count={1} />);

  // Four blocks per row — chip, two lines, value — so the count is what
  // distinguishes a placeholder for a long list from one for a short one.
  expect(countBlocks(four.toJSON())).toBe(16);
  expect(countBlocks(one.toJSON())).toBe(4);
});

it('draws cards where a screen loads cards rather than rows', async () => {
  const { getByLabelText, toJSON } = await render(<SkeletonCards count={2} />);

  expect(getByLabelText('Loading')).toBeTruthy();
  // Four per card: the card's own surface, plus the three lines on it.
  expect(countBlocks(toJSON())).toBe(8);
});

it('draws prose with a short last line, where a screen loads words', async () => {
  const { getByLabelText, toJSON } = await render(<SkeletonText lines={4} />);

  expect(getByLabelText('Loading')).toBeTruthy();
  expect(countBlocks(toJSON())).toBe(4);

  /*
    **The ragged last line is the whole point of this shape.** Four equal bars
    read as a table or a form; a paragraph stops mid-line, and that single
    difference is what makes a reader see words rather than blocks. Asserted on
    the widths because it is the only thing distinguishing this from
    `SkeletonRows`, and it is one edit away from being lost.

    Mutation check: make every line '100%' and this fails.
  */
  const widths = collect(toJSON())
    .filter((style) => style.backgroundColor !== undefined)
    .map((style) => style.width);

  expect(widths.slice(0, 3)).toEqual(['100%', '100%', '100%']);
  expect(widths[3]).toBe('58%');
});

it('announces prose once, however many lines it draws', async () => {
  // The same rule the rows follow: a placeholder that linearises into eight
  // unlabelled views is noise in place of the one fact that matters.
  const { getAllByLabelText } = await render(<SkeletonText lines={8} />);

  expect(getAllByLabelText('Loading')).toHaveLength(1);
});

it('holds still, and at full opacity, when the phone asks for reduced motion', async () => {
  reduceMotion.mockResolvedValue(true);

  const { findByLabelText, toJSON } = await render(<SkeletonRows count={2} />);

  await findByLabelText('Loading');

  /*
    A plain number rather than an `Animated.Value`, which is what proves no loop
    is running — and 1 rather than the dim end, because a static half-faded
    block reads as disabled rather than as loading. Make `usePulse` ignore the
    flag and this comes back as an animated node.
  */
  for (const opacity of opacities(toJSON())) {
    expect(opacity).toBe(1);
  }
});

it('pulses when motion is allowed', async () => {
  const { findByLabelText, toJSON } = await render(<Skeleton />);

  await findByLabelText;

  // An animated node serialises as an object, never as the bare 1 above.
  expect(opacities(toJSON()).every((value) => value === 1)).toBe(false);
});

/** Every leaf `View` with a background — one per block. */
function countBlocks(tree: unknown): number {
  return collect(tree).filter((style) => style.backgroundColor !== undefined).length;
}

/** The opacity each block was rendered with. */
function opacities(tree: unknown): unknown[] {
  return collect(tree)
    .filter((style) => style.backgroundColor !== undefined)
    .map((style) => style.opacity);
}

function collect(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }

  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, out));

    return out;
  }

  const element = node as { props?: { style?: unknown }; children?: unknown };

  if (element.props?.style !== undefined) {
    out.push(flatten(element.props.style));
  }

  collect(element.children, out);

  return out;
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>((all, one) => ({ ...all, ...flatten(one) }), {});
  }

  return (style ?? {}) as Record<string, unknown>;
}
