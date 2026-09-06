import { emphasisSegments } from './prose';

/**
 * Office-authored emphasis.
 *
 * This exists because of what the device showed: the safety guidance rendered
 * `**That stops when you go off duty.**` as literal asterisks, in the middle of
 * the sentence that most needed to be read. The assertions below are the shape
 * of the fix and, just as importantly, the shape of its limits — this
 * interprets one marker and must not grow into a Markdown renderer.
 */

it('marks an emphasised span and drops its markers', () => {
  expect(emphasisSegments('Position stops. **That stops off duty.** Say where you are.')).toEqual([
    { text: 'Position stops. ', strong: false },
    { text: 'That stops off duty.', strong: true },
    { text: ' Say where you are.', strong: false },
  ]);
});

it('returns unmarked prose as one plain segment', () => {
  // The terms and privacy documents are numbered lists with no emphasis. They
  // must come back byte-identical.
  const plain = '1. Provide accurate information.';

  expect(emphasisSegments(plain)).toEqual([{ text: plain, strong: false }]);
});

it('leaves an unclosed marker as literal text rather than guessing', () => {
  // A half-typed marker is a typo. Bolding to the end of the paragraph would be
  // this module deciding what a safety instruction emphasises.
  expect(emphasisSegments('**Careful, the rest is unclosed')).toEqual([
    { text: '**Careful, the rest is unclosed', strong: false },
  ]);
});

it('handles emphasis at the very start and the very end', () => {
  expect(emphasisSegments('**All of it.**')).toEqual([{ text: 'All of it.', strong: true }]);

  expect(emphasisSegments('Ends here **now**')).toEqual([
    { text: 'Ends here ', strong: false },
    { text: 'now', strong: true },
  ]);
});

it('marks more than one span in a paragraph', () => {
  expect(emphasisSegments('**One** and **two**.')).toEqual([
    { text: 'One', strong: true },
    { text: ' and ', strong: false },
    { text: 'two', strong: true },
    { text: '.', strong: false },
  ]);
});

it('emits nothing for an empty span, rather than a segment with no text', () => {
  // An empty `Text` is a stop for a screen reader with nothing to read out.
  expect(emphasisSegments('Before ****after')).toEqual([
    { text: 'Before ', strong: false },
    { text: 'after', strong: false },
  ]);
});

it('reassembles to the original text, markers aside', () => {
  // The property that matters most: nothing is dropped. A renderer that silently
  // ate a clause of safety guidance would be far worse than one printing
  // asterisks.
  const source =
    'Your safety comes first. **End the journey if you feel unsafe.** Then call the office.';

  expect(
    emphasisSegments(source)
      .map((segment) => segment.text)
      .join(''),
  ).toBe(source.replace(/\*\*/g, ''));
});

it('interprets nothing but the one marker', () => {
  // Not a Markdown renderer, and the test says so: a heading, a list dash, an
  // underscore and a link come through untouched.
  const source = '# Heading _italic_ - item [link](http://example.test)';

  expect(emphasisSegments(source)).toEqual([{ text: source, strong: false }]);
});
