import { Linking } from 'react-native';

import type { ContactDetails } from '../api/types';

/**
 * Ringing the other party on a trip (ADR-0024 §7).
 *
 * `tel:` rather than anything cleverer. It hands off to the dialler the driver
 * already knows, works with whatever SIM and network they have, and costs this
 * app no permission — an in-app calling stack would need one, and would still
 * end up placing an ordinary call.
 *
 * **In-app calling and messaging are coming, and this is the seam.** When they
 * land, this function is what changes; no screen needs to know how a call is
 * placed. Until then there is deliberately no SMS counterpart: `ContactChannel`
 * promises a *dialable* number and says nothing about whether it can receive a
 * text, and under the masking provider ADR-0024 §7 designs for, a voice proxy
 * swallows messages silently. A button that fails without saying so, at a
 * pickup, is worse than one that is not there.
 *
 * A failure here is silent on purpose: the only realistic cause is a handset
 * with no dialler, which is not a state a driver can act on, and every caller
 * renders the contact's name beside the button either way.
 */
export async function dialPassenger(contact: ContactDetails): Promise<void> {
  // Spaces stripped, nothing else. Ugandan numbers arrive as "+256 700 123
  // 456" and as "0700123456", and both dial correctly once the spaces are
  // gone — normalising further would mean guessing a country code, which is
  // how a driver ends up ringing the wrong country.
  const url = `tel:${contact.phone.replace(/\s+/g, '')}`;

  try {
    await Linking.openURL(url);
  } catch {
    // Nothing useful to say. The number's owner is named on the screen.
  }
}
