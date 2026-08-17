import { MINIMUM_PASSWORD_LENGTH } from './passwordRules';
import { passwordStrength, STRENGTH_SEGMENTS } from './passwordStrength';

/**
 * The meter behind the change-password and sign-up screens.
 *
 * **The scale is the four rules the screen shows, and meeting them fills the
 * bar.** The previous version graded against a hidden one: a password holding
 * a capital, a lowercase, a digit and a symbol at the stated minimum length —
 * every rule this app names — read "Fair", filled two segments of four, and
 * was told to add four more characters without ever saying what the last two
 * segments wanted. The owner found it on a device and was right: a meter whose
 * standard the driver cannot see is a verdict, not a guide.
 *
 * What survives from the old design, because it was right: **length is a
 * second road to the top**, so a passphrase with no capital and no digit is
 * never marked down for being a passphrase; and **obvious junk is named rather
 * than scored**, however well it ticks the boxes.
 */
function metKeys(password: string): string[] {
  return passwordStrength(password)
    .requirements.filter((requirement) => requirement.met)
    .map((requirement) => requirement.key);
}

// -- The regression this scale exists for ---------------------------------

/**
 * The owner's password, off the screenshot. Mutation check — score variety as
 * one segment however varied, or put the top of the bar beyond the stated
 * minimum, and this fails.
 */
it('fills the bar for a password meeting every rule the app states', () => {
  const strength = passwordStrength('Kim27!ne');

  expect(strength.score).toBe(STRENGTH_SEGMENTS);
  expect(strength.level).toBe('strong');
  // And nothing nagging underneath it. There is nothing left to ask for.
  expect(strength.hint).toBeNull();
});

it('shows the four rules it grades, met or not, so the scale is never hidden', () => {
  expect(metKeys('Kim27!ne')).toEqual(['length', 'case', 'number', 'symbol']);

  // Nine lower-case letters: long enough to send, and nothing else.
  expect(metKeys('kimberley')).toEqual(['length']);
});

it('counts the rules a driver has met, one segment each', () => {
  // length only.
  expect(passwordStrength('kimberley').score).toBe(1);
  // length + case.
  expect(passwordStrength('Kimberley').score).toBe(2);
  // length + case + number.
  expect(passwordStrength('Kimberle9').score).toBe(3);
  // and the symbol.
  expect(passwordStrength('Kimberle9!').score).toBe(4);
});

// -- The floor ------------------------------------------------------------

it('uses the one floor this app already has, rather than a second copy', () => {
  // `passwordRules` owns the number and already has a mutation test on it.
  // This asserts the meter agrees with it: a strength meter that accepted
  // seven characters while the submit rule refused them would tell a driver
  // their password was "Fair" and then refuse it.
  const under = 'Kim2!n'.slice(0, MINIMUM_PASSWORD_LENGTH - 1);
  const exact = 'Kim27!ne'.slice(0, MINIMUM_PASSWORD_LENGTH);

  expect(passwordStrength(under).level).toBe('too-short');
  expect(passwordStrength(exact).level).not.toBe('too-short');
});

it('says nothing at all about an empty field', () => {
  // A meter reading "Too short" against a box nobody has typed in is a
  // scolding, not a guide.
  const strength = passwordStrength('');

  expect(strength.score).toBe(0);
  expect(strength.label).toBe('');
  expect(strength.hint).toBeNull();
});

it('counts down the characters still needed, rather than restating the rule', () => {
  // "2 more characters" is actionable without re-counting what you typed.
  expect(passwordStrength('kettle').hint).toBe('2 more characters to go.');
  expect(passwordStrength('kettles').hint).toBe('1 more character to go.');
});

it('scores nothing below the floor, whatever else is in there', () => {
  // Every other rule met, and still too short to send. The bar must not
  // reward what the form will refuse.
  expect(passwordStrength('Sh0rt!').score).toBe(0);
  expect(passwordStrength('Sh0rt!').level).toBe('too-short');
});

/**
 * The first segment is an acknowledgement, not an achievement: this is a
 * password the form will accept. Mutation check — start the count at zero and
 * a legal password draws an empty bar, which reads as a refusal.
 */
it('fills one segment the moment the password is long enough to send', () => {
  expect(passwordStrength('kimberley').score).toBeGreaterThanOrEqual(1);
});

// -- The second road, for the passphrase ----------------------------------

/**
 * The principle the old scale got right and this one keeps. A twenty-character
 * passphrase holds no capital, no digit and no punctuation, and is stronger
 * than anything eight characters long can be — grading it on the checklist
 * alone would tell a driver to wreck it.
 */
it('lets length alone reach the top of the meter', () => {
  const passphrase = 'my blue kettle sings';
  const strength = passwordStrength(passphrase);

  expect(strength.score).toBe(STRENGTH_SEGMENTS);
  expect(strength.level).toBe('strong');
  // Three of the four rules are unticked. A full bar over unticked boxes reads
  // as a bug unless something says why, and this is the only case where the
  // checklist cannot speak for itself.
  expect(strength.hint).toBe('Long enough that the rest is optional.');
});

it('never marks a passphrase down for being one', () => {
  // Asserted as a relation rather than as fixed scores: the claim is that
  // length is never *punished*, and fixed numbers would let a rescale pass
  // while inverting it.
  const scramble = passwordStrength('Xf7!qR2$').score;
  const passphrase = passwordStrength('my blue kettle sings').score;

  expect(passphrase).toBeGreaterThanOrEqual(scramble);
});

/**
 * The bar only ever goes up while somebody is typing.
 *
 * A meter that fell as a password grew would be read as a bug, and rightly:
 * both roads are counts of things earned and neither takes one away. Mutation
 * check — make any step subtract and this fails.
 */
it('never falls as a password gets longer', () => {
  let previous = 0;

  for (let length = MINIMUM_PASSWORD_LENGTH; length <= 30; length += 1) {
    const score = passwordStrength('my blue kettle sings loudly at dawn'.slice(0, length)).score;

    expect(score).toBeGreaterThanOrEqual(previous);
    previous = score;
  }
});

// -- Junk that ticks every box --------------------------------------------

it('refuses to be impressed by one character repeated', () => {
  // 30 characters, and a single guess.
  const strength = passwordStrength('kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk');

  expect(strength.score).toBe(1);
  expect(strength.level).toBe('weak');
  expect(strength.hint).toBe('One character repeated is one character to guess.');
});

it('refuses to be impressed by a short pattern repeated', () => {
  const strength = passwordStrength('abababababab');

  expect(strength.score).toBe(1);
  expect(strength.hint).toBe('A repeated pattern is only as hard to guess as the part that repeats.');
});

it('names a straight run along the keyboard, forwards or backwards', () => {
  expect(passwordStrength('12345678').score).toBe(1);
  expect(passwordStrength('87654321').score).toBe(1);
  expect(passwordStrength('abcdefghijkl').hint).toBe(
    'Keys in order are the first thing anyone tries.',
  );
});

/**
 * The case that proves the checklist is not the whole story. "Password1234!"
 * ticks every one of the four rules and is the first thing anyone guesses; a
 * meter that only counted ticks would call it Strong.
 */
it('names the obvious guesses rather than scoring them, however well they tick', () => {
  expect(metKeys('Password1234!')).toEqual(['length', 'case', 'number', 'symbol']);

  const strength = passwordStrength('Password1234!');

  expect(strength.score).toBe(1);
  expect(strength.hint).toBe('That contains one of the first passwords anyone would guess.');
});

it('catches the platform s own name wherever it appears, not only at the start', () => {
  expect(passwordStrength('KangaruRide2024').score).toBe(1);
  expect(passwordStrength('myKangaru2024!!').score).toBe(1);
  expect(passwordStrength('kampala is home').score).toBe(1);
});

// -- What the bar says out loud -------------------------------------------

it('gives every level a word, because colour alone carries no meaning', () => {
  // `docs/screen-rules.md` §6. A bar with no label is unreadable to a
  // colour-blind driver and to anyone glancing at a phone in the sun.
  const samples = ['kimberley', 'Kimberley', 'Kimberle9', 'Kim27!ne'];

  for (const sample of samples) {
    expect(passwordStrength(sample).label).not.toBe('');
  }
});

/**
 * Silence is the default once the checklist can speak for itself. A meter that
 * always has something to say is one people stop reading, and the ticks
 * already name what is missing.
 */
it('stops advising once the checklist is saying it', () => {
  expect(passwordStrength('Kimberley').hint).toBeNull();
  expect(passwordStrength('Kim27!ne').hint).toBeNull();
});

it('never scores above the segments the bar draws, or below one for a legal password', () => {
  const samples = [
    'kimberley',
    'Kim27!ne',
    'Ab3!kettle sings loudly and long enough to run out of segments',
    'kkkkkkkkkkkkkkkk',
    'my blue kettle sings',
  ];

  for (const sample of samples) {
    const { score } = passwordStrength(sample);

    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(STRENGTH_SEGMENTS);
  }
});
