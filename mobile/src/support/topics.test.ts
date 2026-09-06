import { findHelpTopic, helpTopics, supportMailto } from './topics';

/**
 * The help topics, as data.
 *
 * The screens have their own suites. This one pins the two properties that are
 * about the *list* rather than about any screen: that a bad key degrades to no
 * topic instead of to the wrong one, and that nothing here promises a
 * destination the platform does not have.
 */

it('degrades an unknown or missing key to no topic, rather than to the first one', () => {
  // The deep-link case. Falling back to `helpTopics[0]` would silently answer a
  // different question than the driver asked — "Report an issue" prompts for
  // nothing a payment dispute needs.
  expect(findHelpTopic(undefined)).toBeNull();
  expect(findHelpTopic('')).toBeNull();
  expect(findHelpTopic('passenger-issue')).toBeNull();

  expect(findHelpTopic('passenger')?.label).toBe('Passenger issue');
});

it('gives every topic something for the driver to have ready before they dial', () => {
  // A topic whose only content is its own label is a row that changed nothing —
  // the driver would have been better served by the plain support screen.
  for (const topic of helpTopics) {
    expect(topic.prepare.length).toBeGreaterThan(0);
    expect(topic.summary.trim()).not.toBe('');
  }
});

it('prefills a mail subject and never a body, so no complaint is written for the driver', () => {
  const topic = findHelpTopic('vehicle');

  expect(supportMailto('office@example.test', topic)).toBe(
    'mailto:office@example.test?subject=Vehicle%20issue',
  );
  // Whatever this module put in a body would arrive at the office looking like
  // the driver's own words.
  expect(supportMailto('office@example.test', topic)).not.toContain('body=');
});

it('falls back to a bare mailto when there is no topic, so the drawer route is unchanged', () => {
  expect(supportMailto('office@example.test', null)).toBe('mailto:office@example.test');
});

it('promises no reference number, ticket or reply, because none exists', () => {
  // There is no issue-reporting endpoint on this platform. A prompt mentioning
  // a ticket or a response time would be inventing the feature in copy.
  const prose = helpTopics
    .flatMap((topic) => [topic.label, topic.summary, ...topic.prepare])
    .join(' ')
    .toLowerCase();

  for (const promise of ['ticket', 'reference number', 'we will get back', 'within 24', 'submit']) {
    expect(prose).not.toContain(promise);
  }
});
