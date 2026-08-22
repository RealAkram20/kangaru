import * as Sentry from '@sentry/react-native';

import { startObservability } from './observability';

/**
 * The switch, and only the switch.
 *
 * Every `Sentry.logger.*` call added across this app — the lock-screen
 * answer, the parked outbox item, the refused foreground service — is a
 * no-op unless `init` is called with `enableLogs: true`. Nothing else in the
 * suite can tell the difference: a mocked logger records the call whether or
 * not logs are switched on, so a hundred passing screen tests would say
 * nothing about whether a single line ever leaves the handset.
 *
 * That makes this the one guard worth having for the feature, and it is
 * asserted against the options object actually handed to the SDK rather than
 * against anything this file re-states.
 */

const init = Sentry.init as jest.Mock;

type InitOptions = Parameters<typeof Sentry.init>[0];

function optionsFromLastInit(): InitOptions {
  return init.mock.calls[init.mock.calls.length - 1]?.[0] as InitOptions;
}

describe('startObservability', () => {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (dsn === undefined) {
      delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    } else {
      process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
    }
  });

  it('does nothing at all without a DSN', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;

    startObservability();

    expect(init).not.toHaveBeenCalled();
  });

  describe('with a DSN', () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@o1.ingest.de.sentry.io/2';
      startObservability();
    });

    it('switches logs on', () => {
      expect(optionsFromLastInit().enableLogs).toBe(true);
    });

    /**
     * The default is `'all'`, which forwards the native log stream as well —
     * every library's Logcat chatter from a phone on a metered Ugandan data
     * bundle. A change of this value is a change to somebody's bill.
     */
    it('takes JavaScript logs only, not the native stream', () => {
      expect(optionsFromLastInit().logsOrigin).toBe('js');
    });

    /**
     * `GpsPingBuffer` and `HttpOutboxTransport` both announce their one
     * diagnostic through an injected `warn` port that defaults to
     * `console.warn` — the odometer photo abandoned after three failed
     * attempts is reported *there and nowhere else*. Dropping this
     * integration would silently unhook both of them.
     */
    it('captures console.warn and console.error, and no lower level', () => {
      expect(Sentry.consoleLoggingIntegration).toHaveBeenCalledWith({
        levels: ['warn', 'error'],
      });
    });

    it('drops debug and trace outside development', () => {
      const beforeSendLog = optionsFromLastInit().beforeSendLog;
      const dev = __DEV__;

      // The production case is the one under test, and `__DEV__` is true in
      // this runner. Restored in a `finally` so a failed expectation cannot
      // leave the rest of the suite running as a release build.
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

      try {
        expect(beforeSendLog?.({ level: 'debug', message: 'noise' })).toBeNull();
        expect(beforeSendLog?.({ level: 'trace', message: 'noise' })).toBeNull();
        expect(beforeSendLog?.({ level: 'warn', message: 'kept' })).not.toBeNull();
        expect(beforeSendLog?.({ level: 'error', message: 'kept' })).not.toBeNull();
      } finally {
        (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
      }
    });

    /**
     * `expo-location` writes this to `console.warn` on every duty toggle and
     * every sign-out inside Expo Go, and the console integration forwards it.
     * It reports a limitation of the *runtime*, not a fault in the app.
     *
     * The guard is on the message, which is normally the wrong thing to match
     * on — safe here only because the string is Expo Go's own and cannot
     * appear in a development build or in release. A neighbouring warning is
     * asserted through as well, so a future widening of this rule fails here
     * rather than silently swallowing real logs.
     */
    it('drops the Expo Go background-location warning, and only that', () => {
      const beforeSendLog = optionsFromLastInit().beforeSendLog;

      expect(
        beforeSendLog?.({
          level: 'warn',
          message:
            'Background location is limited in Expo Go:\nOn Android, it is not available at all.',
        }),
      ).toBeNull();

      expect(
        beforeSendLog?.({ level: 'warn', message: 'Outbox stalled: nothing is going out' }),
      ).not.toBeNull();
    });

    /** So a report can be read without knowing which handset it came from. */
    it('attaches the platform to everything', () => {
      expect(Sentry.getGlobalScope().setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({ platform: expect.any(String) }),
      );
    });
  });
});
