import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverDocumentSlot } from '../api/endpoints';
import { DocumentsScreen } from './DocumentsScreen';

/**
 * That the documents screen mounts, and that the two things it must never get
 * wrong stay right.
 *
 * `profile/presentation.test.ts` owns the wording. The properties here are the
 * ones a docblock alone would not keep true:
 *
 * - **Every type is listed, including the ones never sent.** The screen answers
 *   "what do I still owe you", which the uploaded subset cannot.
 * - **An expired document is drawn as expired**, not as verified — even though
 *   its stored `status` still says verified, because nothing wrote to the row.
 * - **A type that needs an expiry asks for one before uploading**, rather than
 *   sending a photograph the server will refuse.
 * - **A failed upload says it needed a connection**, because unlike everything
 *   else in this app it is not queued.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockUseDriverDocuments = jest.fn();
const mockUpload = jest.fn();

jest.mock('../profile/queries', () => ({
  useDriverDocuments: () => mockUseDriverDocuments(),
  useUploadDocument: () => ({ mutateAsync: mockUpload }),
}));

function slot(overrides: Partial<DriverDocumentSlot> = {}): DriverDocumentSlot {
  return {
    type: 'driving_licence',
    type_label: 'Driving licence',
    hint: 'Both sides if the details are split across them.',
    requires_expiry: true,
    document: null,
    ...overrides,
  };
}

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    driver_id: 2,
    type: 'driving_licence' as const,
    type_label: 'Driving licence',
    status: 'verified' as const,
    status_label: 'Verified',
    compliance_state: 'verified' as const,
    expires_at: '2028-03-14',
    expired: false,
    original_name: 'licence.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 240_000,
    uploaded_at: '2026-08-15T10:00:00+03:00',
    rejection_reason: null,
    reviewed_at: '2026-08-15T11:00:00+03:00',
    file_url: '/api/v1/me/documents/1/file',
    ...overrides,
  } as NonNullable<DriverDocumentSlot['document']>;
}

const ALL_FOUR: DriverDocumentSlot[] = [
  slot({ document: document() }),
  // Verified with **no expiry** — the combination the seeded database actually
  // produces, and the one the first version of this fixture was missing. It is
  // the row that showed an upload hint under a document already on file.
  slot({
    type: 'identity_document',
    type_label: 'Identity document',
    requires_expiry: false,
    hint: 'A national ID, passport, or whatever your country issues.',
    document: document({
      id: 2,
      type: 'identity_document',
      type_label: 'Identity document',
      expires_at: null,
    }),
  }),
  slot({
    type: 'vehicle_insurance',
    type_label: 'Vehicle insurance',
    hint: 'The current certificate for the vehicle you drive.',
    document: document({
      id: 3,
      type: 'vehicle_insurance',
      type_label: 'Vehicle insurance',
      status: 'pending',
      status_label: 'Waiting for the office',
      compliance_state: 'pending',
      expires_at: '2026-11-30',
    }),
  }),
  slot({
    type: 'vehicle_registration',
    type_label: 'Vehicle registration',
    requires_expiry: false,
    hint: 'Proof the vehicle is registered to its owner.',
    document: document({
      id: 4,
      type: 'vehicle_registration',
      type_label: 'Vehicle registration',
      status: 'rejected',
      status_label: 'Rejected',
      compliance_state: 'rejected',
      expires_at: null,
      rejection_reason: 'The photo is too dark to read the chassis number.',
    }),
  }),
];

const navigation = { goBack: jest.fn() } as never;

async function renderDocuments(element: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDriverDocuments.mockReturnValue({
    data: {
      slots: ALL_FOUR,
      compliance: { state: 'action_needed', verified: 1, total: 4, action_needed: 1, pending: 1 },
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockUpload.mockResolvedValue(document());
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true });
});

it('lists every type, including the ones never sent', async () => {
  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  expect(screen.getByText('Driving licence')).toBeTruthy();
  expect(screen.getByText('Identity document')).toBeTruthy();
  expect(screen.getByText('Vehicle insurance')).toBeTruthy();
  expect(screen.getByText('Vehicle registration')).toBeTruthy();
});

it('draws a type never sent as an empty slot, not as an omission', async () => {
  // The empty slot is the point: a driver is asking what they still owe. The
  // server sends every type back with a null document precisely so this row
  // can exist, and omitting it would answer "what have I sent" instead.
  mockUseDriverDocuments.mockReturnValue({
    data: {
      slots: [slot({ document: null })],
      compliance: { state: 'incomplete', verified: 0, total: 4, action_needed: 0, pending: 0 },
    },
    isLoading: false,
  });

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  expect(screen.getByText('Not sent yet')).toBeTruthy();
  expect(screen.getByText('Both sides if the details are split across them.')).toBeTruthy();
  expect(screen.getByLabelText('Take a photo: driving licence')).toBeTruthy();
});

it("shows the office's reason on a rejection", async () => {
  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  expect(screen.getByText('The photo is too dark to read the chassis number.')).toBeTruthy();
});

it('draws an expired document as expired, not as verified', async () => {
  // **The important one.** The stored status still says `verified` because
  // nothing wrote to the row; only `compliance_state` knows the date passed.
  mockUseDriverDocuments.mockReturnValue({
    data: {
      slots: [
        slot({
          document: document({
            status: 'verified',
            compliance_state: 'expired',
            expired: true,
            expires_at: '2026-07-01',
          }),
        }),
      ],
      compliance: { state: 'action_needed', verified: 0, total: 4, action_needed: 1, pending: 0 },
    },
    isLoading: false,
  });

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  expect(screen.getByText('Expired')).toBeTruthy();
  expect(screen.getByText('Expired Jul 2026')).toBeTruthy();
  expect(screen.queryByText('Verified')).toBeNull();
});

it('asks when a licence expires before sending it', async () => {
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///licence.jpg' }],
  });

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Replace it: driving licence'));

  // The picker appears and nothing has been uploaded: the server refuses a
  // licence with no expiry, and learning that as a validation error on a photo
  // already taken is the worst order to learn it in.
  await waitFor(() => expect(screen.getByTestId('expiry-picker')).toBeTruthy());
  expect(mockUpload).not.toHaveBeenCalled();
});

/*
 * The two branches of the expiry picker, which nothing exercised until the
 * deprecated `onChange` was split into `onValueChange` / `onDismiss`
 * (datetimepicker 9). The screen appearing was tested; what it did with the
 * answer was not — and that answer is what decides whether a licence is
 * uploaded against a date the driver never chose.
 */
it('uploads with the date the driver picked', async () => {
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///licence.jpg' }],
  });

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Replace it: driving licence'));
  await waitFor(() => expect(screen.getByTestId('expiry-picker')).toBeTruthy());

  await fireEvent(
    screen.getByTestId('expiry-picker'),
    'valueChange',
    { type: 'set' },
    new Date(2027, 2, 14),
  );

  await waitFor(() =>
    expect(mockUpload).toHaveBeenCalledWith({
      type: 'driving_licence',
      uri: 'file:///licence.jpg',
      expiresAt: '2027-03-14',
    }),
  );
});

it('uploads nothing when the driver cancels the expiry picker', async () => {
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///licence.jpg' }],
  });

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Replace it: driving licence'));
  await waitFor(() => expect(screen.getByTestId('expiry-picker')).toBeTruthy());

  await fireEvent(screen.getByTestId('expiry-picker'), 'dismiss');

  // Nothing sent, and the picker gone. A document uploaded against a date the
  // driver backed out of is the failure this branch exists to prevent.
  await waitFor(() => expect(screen.queryByTestId('expiry-picker')).toBeNull());
  expect(mockUpload).not.toHaveBeenCalled();
});

it('sends without asking for a date when the type does not carry one', async () => {
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///id.jpg' }],
  });

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Replace it: identity document'));

  await waitFor(() =>
    expect(mockUpload).toHaveBeenCalledWith({
      type: 'identity_document',
      uri: 'file:///id.jpg',
      expiresAt: null,
    }),
  );

  // `requires_expiry` is the server's flag, not a copy of the rule here.
  expect(screen.queryByTestId('expiry-picker')).toBeNull();
});

it('says a failed upload needed a connection, because it is not queued', async () => {
  (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///id.jpg' }],
  });
  mockUpload.mockRejectedValue(new Error('offline'));

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Replace it: identity document'));

  // Every other mutation in this app goes through the outbox. A driver who
  // assumed this one did too would walk away believing the office had their
  // licence.
  await waitFor(() => expect(screen.getByText(/not queued/)).toBeTruthy());
});

it('warns about replacing only where there is a verification to lose', async () => {
  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  // ADR-0033 §2. A driver who has just been verified deserves to know before
  // they retake a photo out of habit.
  //
  // **Two of the four rows, not four.** Reading the rendered screen caught the
  // first version showing this under the *rejected* row, where sending another
  // photo is precisely what the office asked for, and under the *pending* one,
  // where there is no review to restart.
  expect(
    screen.getAllByText('A new photo is checked again.'),
  ).toHaveLength(2);
});

it('asks a rejected document to be sent again, not replaced', async () => {
  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  // "Replace it" describes swapping out something that worked. The office has
  // asked for this one again.
  expect(screen.getByLabelText('Send it again: vehicle registration')).toBeTruthy();
});

it('does not tell a verified driver to do what they have already done', async () => {
  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  // The verified identity document was showing its upload hint — an
  // instruction to photograph a thing that is already on file.
  expect(screen.getByText('Accepted by the office.')).toBeTruthy();
  expect(
    screen.queryByText('A national ID, passport, or whatever your country issues.'),
  ).toBeNull();
});

it('never shows a blank page when the list could not be loaded', async () => {
  // Found by walking the failure path, not by a test: without this the screen
  // rendered its footnote alone, which reads as "you have no documents" — the
  // opposite of the truth, on the screen whose whole subject is what the
  // office is holding.
  mockUseDriverDocuments.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
    refetch: jest.fn(),
  });

  const screen = await renderDocuments(
    <DocumentsScreen navigation={navigation} route={{} as never} />,
  );

  expect(screen.getByText(/Could not load your documents/)).toBeTruthy();
  expect(screen.getByLabelText('Try again')).toBeTruthy();
  // The hand-checking footnote was cut from this screen in the copy pass:
  // each card's own status chip says the same thing by existing.
  expect(screen.queryByText(/checks each one by hand/)).toBeNull();
});
