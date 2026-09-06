import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverDocumentSlot } from '../api/endpoints';
import { KycVerificationScreen } from './KycVerificationScreen';

/**
 * The KYC screen an applicant lands on straight after sign-up (ADR-0048 §4).
 *
 * The properties a docblock alone would not keep true:
 *
 * - **All six slots are drawn, under the mockup's three headings**, including
 *   the ones never sent — the applicant is asking what they still owe.
 * - **Nothing is required.** *Submit for Review* works with six empty rows,
 *   because ADR-0048 §6 makes every document optional at application time. A
 *   disabled button here would be a rule the platform does not have.
 * - **A type that needs an expiry asks for one before uploading**, rather than
 *   sending a photograph the server will refuse.
 * - **A spent ticket ends the screen honestly** — the application is still in
 *   the queue, and there is no way to mint another ticket (ADR-0027 §5).
 * - **A failed upload says it needed a connection**, because unlike everything
 *   else in this app it is not queued (ADR-0023).
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockList = jest.fn();
const mockUpload = jest.fn();

jest.mock('../documents/applicationDocuments', () => {
  class UploadTicketSpentError extends Error {}

  return {
    listApplicationDocuments: (...args: unknown[]) => mockList(...args),
    uploadApplicationDocument: (...args: unknown[]) => mockUpload(...args),
    UploadTicketSpentError,
  };
});

// The picker is a native module; the sheet is exercised through its own props
// rather than by driving a camera that does not exist in jest.
const mockPick = jest.fn();

jest.mock('../documents/MediaPickerSheet', () => {
  const { Pressable, Text } = jest.requireActual('react-native');

  return {
    MediaPickerSheet: ({
      title,
      onPicked,
    }: {
      title: string;
      onPicked: (media: { uri: string }) => void;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`pick ${title}`}
        onPress={() => {
          mockPick(title);
          onPicked({ uri: 'file:///licence.jpg' });
        }}
      >
        <Text>pick</Text>
      </Pressable>
    ),
  };
});

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ api: {} }),
}));

function slot(overrides: Partial<DriverDocumentSlot> = {}): DriverDocumentSlot {
  return {
    type: 'identity_document',
    type_label: 'National ID',
    hint: 'A national ID, passport, or whatever your country issues.',
    requires_expiry: false,
    group: 'personal',
    group_label: 'Personal information',
    document: null,
    ...overrides,
  };
}

const SIX = [
  slot({ type: 'identity_document', type_label: 'National ID' }),
  slot({ type: 'identity_selfie', type_label: 'Selfie' }),
  slot({
    type: 'driving_licence',
    type_label: "Driver's licence",
    requires_expiry: true,
    group: 'driver',
    group_label: 'Driver information',
  }),
  slot({
    type: 'vehicle_registration',
    type_label: 'Vehicle registration',
    group: 'driver',
    group_label: 'Driver information',
  }),
  slot({
    type: 'vehicle_insurance',
    type_label: 'Insurance certificate',
    requires_expiry: true,
    group: 'driver',
    group_label: 'Driver information',
  }),
  slot({
    type: 'vehicle_photo',
    type_label: 'Vehicle photo',
    group: 'vehicle',
    group_label: 'Vehicle information',
  }),
];

function renderKyc(element: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
}

function screenUnderTest(onDone = jest.fn()) {
  return renderKyc(
    <KycVerificationScreen uploadToken={'t'.repeat(64)} phone="+256700000000" onDone={onDone} />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue(SIX);
  mockUpload.mockResolvedValue(undefined);
});

it('draws all six slots under the three headings from the mockup', async () => {
  const screen = await screenUnderTest();

  await waitFor(() => expect(screen.getByText('National ID')).toBeTruthy());

  expect(screen.getByText('Personal information')).toBeTruthy();
  expect(screen.getByText('Driver information')).toBeTruthy();
  expect(screen.getByText('Vehicle information')).toBeTruthy();

  expect(screen.getByText('Selfie')).toBeTruthy();
  expect(screen.getByText("Driver's licence")).toBeTruthy();
  expect(screen.getByText('Vehicle registration')).toBeTruthy();
  expect(screen.getByText('Insurance certificate')).toBeTruthy();
  expect(screen.getByText('Vehicle photo')).toBeTruthy();
});

/**
 * ADR-0048 §6, which is the rule most likely to be "tidied" into a disabled
 * button by somebody who assumes a KYC screen must be completed.
 */
it('lets an applicant submit with nothing uploaded at all', async () => {
  const screen = await screenUnderTest();

  await waitFor(() => expect(screen.getByText('National ID')).toBeTruthy());

  expect(screen.getByText(/Nothing here is required/)).toBeTruthy();

  await fireEvent.press(screen.getByText('Submit for Review'));

  await waitFor(() => expect(screen.getByText('Application received')).toBeTruthy());
});

it('asks when a licence expires before it sends the photo', async () => {
  const screen = await screenUnderTest();

  await waitFor(() => expect(screen.getByText("Driver's licence")).toBeTruthy());

  await fireEvent.press(screen.getByText("Driver's licence"));
  await fireEvent.press(await screen.findByLabelText("pick Driver's licence"));

  // The picker is up and nothing has been uploaded — the expiry is asked for
  // first, because the server refuses this type without one and finding that
  // out as a validation error on a photo already taken is the worst order.
  expect(await screen.findByTestId('expiry-picker')).toBeTruthy();
  expect(mockUpload).not.toHaveBeenCalled();
});

it('sends a document that needs no expiry straight away', async () => {
  const screen = await screenUnderTest();

  await waitFor(() => expect(screen.getByText('National ID')).toBeTruthy());

  await fireEvent.press(screen.getByText('National ID'));
  await fireEvent.press(await screen.findByLabelText('pick National ID'));

  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

  expect(mockUpload).toHaveBeenCalledWith({}, 't'.repeat(64), {
    type: 'identity_document',
    uri: 'file:///licence.jpg',
    expiresAt: null,
  });

  expect(screen.queryByTestId('expiry-picker')).toBeNull();
});

/**
 * The refusal has to name the reason. Every other mutation in this app
 * survives a dead zone through the outbox (ADR-0023) and this one does not, so
 * an applicant who has just watched an upload fail needs to know it was not
 * quietly queued for later.
 */
it('says an upload was not queued when it fails', async () => {
  mockUpload.mockRejectedValue(new Error('offline'));

  const screen = await screenUnderTest();

  await waitFor(() => expect(screen.getByText('National ID')).toBeTruthy());

  await fireEvent.press(screen.getByText('National ID'));
  await fireEvent.press(await screen.findByLabelText('pick National ID'));

  expect(await screen.findByText(/not queued/i)).toBeTruthy();
});

it('ends honestly when the upload ticket has been spent', async () => {
  const { UploadTicketSpentError } = jest.requireMock('../documents/applicationDocuments');

  mockList.mockRejectedValue(new UploadTicketSpentError());

  const screen = await screenUnderTest();

  expect(await screen.findByText('This upload link has expired')).toBeTruthy();

  // The application survives the ticket, and the screen says where the
  // documents go instead rather than leaving somebody to assume they must
  // apply again.
  expect(screen.getByText(/still with the office/i)).toBeTruthy();
});

it('names the number the office will ring on the confirmation', async () => {
  const screen = await screenUnderTest();

  await waitFor(() => expect(screen.getByText('National ID')).toBeTruthy());

  await fireEvent.press(screen.getByText('Submit for Review'));

  expect(await screen.findByText(/\+256700000000/)).toBeTruthy();
});
