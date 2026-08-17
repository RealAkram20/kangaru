/**
 * The five things a driver comes to Help & Safety to report.
 *
 * ## Why this is data and not five endpoints
 *
 * The mockup draws these as a list of navigable rows, and the obvious reading
 * is a ticket queue: tap *Passenger issue*, type what happened, submit. **That
 * is not built, and it is not a gap left out of laziness.** There is no
 * issue-reporting endpoint anywhere on this platform — no table, no route, no
 * inbox on the office side — and there is no messaging either, deliberately
 * (`trips/contact.ts` documents that seam and its reason).
 *
 * A text box that posts nowhere is the same failure the SOS button was refused
 * for: it takes somebody's real problem, gives them the feeling of having
 * reported it, and drops it. A driver who has "reported" a passenger who
 * threatened them and hears nothing back has been handled, not helped.
 *
 * So a topic is not a form. It is **the office's phone number, plus the facts
 * they are going to ask for**, which is the part a driver cannot look up while
 * they are on the call. `SupportScreen` already had the number and the
 * driver's own details; a topic adds the two or three specifics that particular
 * conversation needs, and prefills the subject line when there is an email
 * address to use.
 *
 * That makes the rows real navigation to a real destination, with nothing
 * invented — and it leaves the honest version of the mockup's intent buildable
 * later, as a backend feature with an ADR, rather than faked now.
 *
 * ## Why the labels are the mockup's, exactly
 *
 * `report` is the catch-all and stays first, as drawn. The other four are the
 * calls the office actually gets, and a driver scanning for "my car" should not
 * have to decide whether that counts as an issue.
 */

export type HelpTopicKey = 'report' | 'passenger' | 'vehicle' | 'payment' | 'lost-item';

export type HelpTopic = {
  key: HelpTopicKey;
  /** The row label on Help & Safety, and the heading on Support. */
  label: string;
  /**
   * One line under the heading on Support, saying what this conversation is
   * for. Kept short: it is read while the dialler is one tap away.
   */
  summary: string;
  /**
   * What the office will ask for, in the order they ask. Rendered as a list
   * *before* the driver dials, which is the whole point — reciting a trip
   * number from memory in traffic is how a support call takes ten minutes.
   *
   * Never a value the app would have to compute. These are prompts, not data.
   */
  prepare: string[];
};

export const helpTopics: readonly HelpTopic[] = [
  {
    key: 'report',
    label: 'Report an issue',
    summary: 'Anything that went wrong and does not fit the topics below.',
    prepare: [
      'What happened, in one or two sentences',
      'When it happened',
      'The trip, if it was on one',
    ],
  },
  {
    key: 'passenger',
    label: 'Passenger issue',
    summary: 'A passenger who was abusive, refused to pay, or did not travel.',
    prepare: ['The trip number', 'Where you picked up, or were meant to', 'What the passenger did'],
  },
  {
    key: 'vehicle',
    label: 'Vehicle issue',
    summary: 'A breakdown, damage, or something that makes the vehicle unsafe to drive.',
    prepare: [
      'The registration number',
      'What is wrong, and whether the vehicle is drivable',
      'Where the vehicle is now',
    ],
  },
  {
    key: 'payment',
    label: 'Payment issue',
    summary: 'A fare, a bonus, or a wallet balance that looks wrong.',
    prepare: [
      'The trip number, or the date the amount is for',
      'What you expected, and what the app shows',
      'Whether the passenger paid cash',
    ],
  },
  {
    key: 'lost-item',
    label: 'Lost item',
    summary: 'Something a passenger left in the vehicle, or something of yours gone missing.',
    prepare: ['The trip number', 'What the item is', 'Whether you still have it'],
  },
];

/**
 * The topic a route param names, or `null`.
 *
 * `null` rather than a throw or a default: `Support` is reachable without a
 * topic at all (the Contact Support card, and the Settings row that predates
 * this screen), and a stale deep link naming a topic that no longer exists
 * should land on the plain support screen rather than crash the app or
 * silently answer a different question.
 */
export function findHelpTopic(key: string | undefined): HelpTopic | null {
  if (key === undefined) {
    return null;
  }

  return helpTopics.find((topic) => topic.key === key) ?? null;
}

/**
 * A `mailto:` for the office, with the topic in the subject.
 *
 * The subject is prefilled and the **body is not**. A prefilled body would be
 * this module writing the driver's complaint for them, in English, in a
 * register that may not be theirs — and whatever it said would arrive at the
 * office looking like the driver's own words.
 */
export function supportMailto(email: string, topic: HelpTopic | null): string {
  if (topic === null) {
    return `mailto:${email}`;
  }

  return `mailto:${email}?subject=${encodeURIComponent(topic.label)}`;
}
