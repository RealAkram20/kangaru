/**
 * Office-authored prose, split so emphasis survives.
 *
 * ## Why this exists
 *
 * The safety guidance is a settings value an administrator edits, and the one
 * currently shipped contains **`**That stops when you go off duty.**`** — the
 * single most important sentence in it, deliberately emphasised by whoever
 * wrote it. Rendered as a plain string it came out on the driver's screen as
 * literal asterisks, which reads as a broken app on the screen that can least
 * afford to look broken.
 *
 * ## This is not a Markdown renderer, and must not become one
 *
 * It interprets exactly one thing: a `**…**` span is emphasis. Nothing else —
 * no headings, no lists, no links, no italics. That is a deliberate floor
 * rather than a first instalment:
 *
 * - **The value has no editor.** The guidance is API-only today
 *   (`docs/agent-worklog.md` records that gap), so there is nobody to teach a
 *   syntax to and no preview to check it against.
 * - **A dependency would be absurd here.** A Markdown package to bold one
 *   sentence is bundle and audit surface for a feature nobody asked for, and
 *   `AGENTS.md` wants no new dependency without asking.
 * - **It degrades to the truth.** Text with no markers comes back as one plain
 *   segment, so the terms and privacy documents — which use numbered lists and
 *   no emphasis — are unaffected.
 *
 * If the office ever needs real formatting, that is a decision with an ADR and
 * a settings editor attached, not an extra branch in here.
 */

export type ProseSegment = {
  text: string;
  /** Whether the office marked this span for emphasis. */
  strong: boolean;
};

/**
 * One paragraph, split into plain and emphasised spans.
 *
 * **An unclosed marker is left alone.** `'**Careful'` comes back as the literal
 * text `'**Careful'` rather than being silently bolded to the end of the
 * paragraph: a half-typed marker is a typo, and guessing what the author meant
 * is how a safety instruction ends up saying something they did not write.
 */
export function emphasisSegments(paragraph: string): ProseSegment[] {
  const segments: ProseSegment[] = [];
  let rest = paragraph;

  while (rest !== '') {
    const open = rest.indexOf('**');

    if (open === -1) {
      segments.push({ text: rest, strong: false });
      break;
    }

    const close = rest.indexOf('**', open + 2);

    if (close === -1) {
      // Unclosed. Everything left is literal, markers and all.
      segments.push({ text: rest, strong: false });
      break;
    }

    if (open > 0) {
      segments.push({ text: rest.slice(0, open), strong: false });
    }

    const inner = rest.slice(open + 2, close);

    /*
      `****` is an empty span. Emitting a zero-length strong segment would put
      an empty `Text` in the tree for a screen reader to stop on, so the
      markers are dropped and nothing is added.
    */
    if (inner !== '') {
      segments.push({ text: inner, strong: true });
    }

    rest = rest.slice(close + 2);
  }

  return segments;
}
