import * as Sentry from '@sentry/react-native';

import { acceptOffer } from '../api/endpoints';
import { ApiError, NetworkError } from '../api/errors';
import { readSession } from '../auth/tokenStore';
import { hideCallNotification } from './callNotification';
import { handleOfferEvent } from './offerAnswer';
import { NOTIFEE_EVENT, resetClaimsForTest } from './offerEvent';

jest.mock('../api/endpoints', () => ({
  acceptOffer: jest.fn(async () => undefined),
  declineOffer: jest.fn(async () => undefined),
}));

jest.mock('../auth/tokenStore', () => ({
  readSession: jest.fn(async () => ({ token: 'driver-token', user: { id: 7 } })),
}));

jest.mock('./callNotification', () => ({
  hideCallNotification: jest.fn(async () => undefined),
}));

/**
 * The one path in this app that is **designed** to say nothing.
 *
 * `handleOfferEvent` swallows every failure on purpose: it runs in a headless
 * task where a rejected promise is reported to Android as the app
 * misbehaving, and there is nothing a driver on a lock screen could do with
 * an error message anyway. That reasoning is sound and it is not what these
 * tests are defending.
 *
 * What they defend is the consequence: a driver taps Accept, the radio is in
 * a dead zone, the job goes to somebody else, and **nothing anywhere records
 * that it happened**. The log is the only trace. Deleting it breaks no
 * screen, no type and no other test — which is exactly the kind of line that
 * disappears in a tidy-up, so it gets a guard of its own.
 */

const acceptPress = {
  type: NOTIFEE_EVENT.ACTION_PRESS,
  notificationId: 'offer-call-41',
  pressActionId: 'offer.accept',
};

describe('answering an offer from the notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetClaimsForTest();
  });

  it('reports a failed answer to Sentry without telling the driver', async () => {
    (acceptOffer as jest.Mock).mockRejectedValueOnce(new NetworkError('The radio was out.'));

    const outcome = await handleOfferEvent(acceptPress);

    // Unchanged behaviour: the caller is told to do nothing, and nothing threw.
    expect(outcome).toEqual({ kind: 'ignore' });

    expect(Sentry.logger.error).toHaveBeenCalledWith(
      'Offer answer from the notification failed',
      expect.objectContaining({ offerId: 41, answer: 'accept', code: 'OFFLINE' }),
    );
  });

  /**
   * The code, not the message: a lost connection and a job somebody else took
   * are the same silence to the driver and two different reports to the
   * office. Grouping on the message would also break the moment the server's
   * wording changes, which AGENTS.md forbids relying on.
   */
  it('reports the server error code when the server answered', async () => {
    (acceptOffer as jest.Mock).mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'OFFER_ALREADY_TAKEN', message: 'Too late.' }),
    );

    await handleOfferEvent(acceptPress);

    expect(Sentry.logger.error).toHaveBeenCalledWith(
      'Offer answer from the notification failed',
      expect.objectContaining({ code: 'OFFER_ALREADY_TAKEN' }),
    );
  });

  it('records how long a successful answer took', async () => {
    const outcome = await handleOfferEvent(acceptPress);

    expect(outcome).toEqual({ kind: 'accept', offerId: 41 });
    expect(Sentry.logger.error).not.toHaveBeenCalled();
    expect(Sentry.logger.info).toHaveBeenCalledWith(
      'Offer answered from the notification',
      expect.objectContaining({ offerId: 41, answer: 'accept' }),
    );
  });

  /**
   * Signed out between the push and the press. Nothing was attempted, so
   * there is nothing to report — a log here would count a failure that never
   * happened on every handset a driver has handed back.
   */
  it('says nothing when there is no session to answer with', async () => {
    (readSession as jest.Mock).mockResolvedValueOnce(null);

    await handleOfferEvent(acceptPress);

    expect(hideCallNotification).toHaveBeenCalledWith(41);
    expect(Sentry.logger.error).not.toHaveBeenCalled();
    expect(Sentry.logger.info).not.toHaveBeenCalled();
  });
});
