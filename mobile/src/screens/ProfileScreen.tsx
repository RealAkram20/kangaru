import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { refusalMessage } from '../api/errors';
import { authorizedImageSource } from '../api/imageSource';
import { useAuth } from '../auth/AuthProvider';
import { ringtoneEnabled, setRingtoneEnabled } from '../duty/ringtonePreference';
import type { ProfileStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import {
  type EditableField,
  OFFICE_MANAGED,
  hasChanged,
  payoutSummary,
  problemWith,
} from '../profile/editing';
import {
  documentsSummary,
  initials,
  monthYear,
  tripsTotal,
  vehicleName,
  vehicleType,
} from '../profile/presentation';
import { closureRowValue } from '../profile/closure';
import { useClosureRequest } from '../profile/closureQueries';
import {
  useDeleteDriverPhoto,
  useDriverProfile,
  useUpdateDriverProfile,
  useUploadDriverPhoto,
} from '../profile/queries';
import { useDriverStats } from '../trips/queries';
import { usePayoutAccount } from '../wallet/payoutQueries';
import { ratingNote, ratingValue } from '../trips/statsPresentation';
import {
  Button,
  Card,
  MenuRow,
  Notice,
  Screen,
  ScreenHeader,
  SwitchRow,
  usePressScale,
} from '../ui/components';
import {
  AlertTriangleIcon,
  BanknoteIcon,
  BellIcon,
  CalendarIcon,
  CameraIcon,
  FileTextIcon,
  LockIcon,
  LogOutIcon,
  PencilIcon,
  SmartphoneIcon,
  StarIcon,
  Trash2Icon,
  WalletIcon,
} from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { appVersion } from '../ui/version';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'ProfileHome'>;

/**
 * The driver's profile — who they are, what they may change, and what the
 * office holds.
 *
 * ## What changed, and why the previous version was right at the time
 *
 * The 2026-08-15 version of this screen removed every navigation row on the
 * owner's instruction ("we don't need to repeat the menus") because the drawer
 * had just taken over the map of the app. **The owner has since reversed that**
 * and asked for the mockup's rows back, plus the two things the screen never
 * had: a way to set the photograph, and a way to correct your own details.
 * Neither reading was wrong; the second is current. The drift risk the earlier
 * entry named is real and unchanged — **this screen and `navigation/drawer.ts`
 * must be edited together**, or a driver who learned the app from one finds
 * rows missing from the other.
 *
 * ## What the mockup asked for that this platform still cannot produce
 *
 * - **A bare "4.8".** ADR-0030 §3 withholds a score below five ratings, and
 *   `ratingValue`/`ratingNote` are the pair the home screen uses. One
 *   vocabulary for one number, and the threshold stays on the server.
 * - **"Bank Details" is now here and now goes somewhere** (ADR-0042). It was
 *   deliberately absent for one pass, because a row that navigates nowhere is
 *   the dead surface `docs/screen-rules.md` refuses, and this one is about
 *   somebody's pay. The row shows the bank's name and **never the account
 *   number, not even masked** — this screen is opened in front of passengers
 *   and dispatchers; the tail belongs on the screen a driver went looking for
 *   it on.
 * - **The danger zone with Delete is here now** (ADR-0043), on the same rule
 *   that kept it off for several passes: a row appears when pressing it reaches
 *   something real, and a Delete that only appears to work is worse than no
 *   Delete. The loop behind it — the request, the office queue that answers it,
 *   the email that carries the answer to somebody who by then cannot sign in —
 *   is built and green. The row keeps the mockup's word; the screen it opens is
 *   the one that explains a closure is not an erasure.
 *
 * ## Settings is gone, and its rows are here
 *
 * There was a `SettingsScreen` holding four rows — Time off, Settling up,
 * Change password, Updates & sync — plus Log out and the version string. The
 * owner's ruling: *"all things in the settings should be moved to profile page,
 * otherwise we are doing repetition"*, and then *"so we don't need the settings
 * page"*. It was repetition: a Profile that listed a Settings that listed four
 * account rows is two taps and two headers for a list that fits on this screen
 * under a word.
 *
 * The screen, its route, its test file and its drawer row are all deleted
 * rather than orphaned. What survived the move intact is the **grouping** —
 * *Work* above, *Account* below — and **Log out as a tinted pill at the foot**
 * rather than a list row, which was the owner's call on the Settings layout and
 * is the same call here: the one control that should sit apart from the things
 * a driver taps daily, never mid-list where a scrolling thumb lands on it.
 *
 * ## The photograph
 *
 * ADR-0041 built `GET/POST/DELETE me/photo` and **nothing ever called them** —
 * the master plan's completeness census records a finished backend no driver
 * could reach. This screen is where it is reached, which is also where the
 * mockup put a face.
 */
export function ProfileScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();
  const { data: profile } = useDriverProfile();
  const { data: stats } = useDriverStats();
  // The banner needs the provider; the parked count is the Updates & sync
  // row's value, which came here when Settings was folded in.
  const { parked } = useSync();

  const { data: payout } = usePayoutAccount();
  // ADR-0043. Read here rather than only on the screen it opens, so the row can
  // answer "did that go through?" without costing a tap.
  const { data: closure } = useClosureRequest();
  const updateProfile = useUpdateDriverProfile();
  const uploadPhoto = useUploadDriverPhoto();
  const deletePhoto = useDeleteDriverPhoto();

  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Seeded from the in-memory value rather than read from storage here.
  // `App.tsx` loads it once at start-up, precisely so the ring path can be
  // synchronous, and asking AsyncStorage again would render the row in the
  // wrong position for a frame before correcting itself — on a switch, that
  // reads as the app having changed the setting on its own.
  const [ringtone, setRingtone] = useState(() => ringtoneEnabled());

  // A driver whose profile has not loaded still knows their own name — the
  // account carries one. Falling back to it beats an em dash where a person's
  // name goes.
  const name = profile?.name ?? user?.name ?? 'Driver';
  const documents = documentsSummary(profile?.documents);
  const photo = profile?.photo_url ?? null;
  const busyWithPhoto = uploadPhoto.isPending || deletePhoto.isPending;

  const beginEdit = (field: EditableField) => {
    setProblem(null);
    setDraft(field === 'name' ? (profile?.name ?? '') : (profile?.phone ?? ''));
    setEditing(field);
  };

  const cancelEdit = () => {
    setEditing(null);
    setProblem(null);
  };

  const saveEdit = async (field: EditableField) => {
    const stopper = problemWith(field, draft);

    if (stopper !== null) {
      setProblem(stopper);

      return;
    }

    // Nothing to send is a successful close, not a request. Saving an
    // unchanged value would write an audit-log entry recording a change
    // nobody made.
    if (!hasChanged(draft, field === 'name' ? (profile?.name ?? null) : (profile?.phone ?? null))) {
      cancelEdit();

      return;
    }

    try {
      await updateProfile.mutateAsync({ [field]: draft.trim() });
      cancelEdit();
    } catch (error) {
      // The office's own words where it answered — it is the thing that knows
      // a phone number was already somebody else's. The connection sentence is
      // kept for the case it describes and no other.
      setProblem(
        refusalMessage(
          error,
          'That did not reach the office. Your details need a connection — unlike your trip work, they are not queued.',
        ),
      );
    }
  };

  const pickPhoto = async (from: 'camera' | 'library') => {
    setProblem(null);

    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setProblem(
        from === 'camera'
          ? 'The camera is not available. Allow it in your phone settings and try again.'
          : 'Your photos are not available. Allow access in your phone settings and try again.',
      );

      return;
    }

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync({
            // The server takes 4 MB — half the document ceiling, because this
            // is rendered at 72 points and never read. Squaring it here means
            // the driver is not paying to upload the parts a circle crops off.
            quality: 0.6,
            allowsEditing: true,
            aspect: [1, 1],
            exif: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            allowsEditing: true,
            aspect: [1, 1],
            exif: false,
            mediaTypes: ['images'],
          });

    if (result.canceled || result.assets[0] === undefined) {
      return;
    }

    try {
      await uploadPhoto.mutateAsync(result.assets[0].uri);
    } catch (error) {
      setProblem(
        refusalMessage(
          error,
          'That photo did not reach the office. It needs a connection — try again.',
        ),
      );
    }
  };

  const choosePhotoSource = () => {
    Alert.alert('Your photo', 'This is what the office and your drawer show.', [
      { text: 'Take a photo', onPress: () => void pickPhoto('camera') },
      { text: 'Choose from your photos', onPress: () => void pickPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const confirmRemovePhoto = () => {
    Alert.alert('Remove your photo?', 'Your initials will be shown instead.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deletePhoto.mutateAsync();
            } catch (error) {
              setProblem(
                refusalMessage(
                  error,
                  'That did not reach the office. Try again when you have a connection.',
                ),
              );
            }
          })();
        },
      },
    ]);
  };

  const confirmSignOut = () => {
    Alert.alert('Log out?', 'Your queued work stays on this phone until you sign back in.', [
      { text: 'Stay signed in', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        // The pill goes busy the moment the dialog closes. Signing out is
        // two bounded server calls plus native teardown — seconds against
        // the production API — and a tap that visibly did nothing for that
        // long reads as ignored, which is how it gets tapped twice. The
        // `finally` is for the day `signOut` returns without unmounting
        // this screen; today the auth switch does the unmounting.
        onPress: () => {
          setSigningOut(true);
          void signOut().finally(() => setSigningOut(false));
        },
      },
    ]);
  };

  return (
    <Screen>
      {/*
        The arrow is explicit rather than `goBack()`, which on a tab root is a
        silent no-op — the pattern `WalletScreen` and `EarningsScreen` set when
        the bar went to four.
      */}
      <ScreenHeader
        title="Driver Profile"
        subtitle={null}
        onBack={() => navigation.getParent()?.navigate('Home')}
      />

      <SyncBanner />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {problem !== null && <Notice message={problem} tone="danger" />}

        <Card>
          <View style={styles.identity}>
            <Pressable
              onPress={choosePhotoSource}
              disabled={busyWithPhoto}
              accessibilityRole="button"
              accessibilityLabel={photo === null ? 'Add your photo' : 'Change your photo'}
              accessibilityState={{ disabled: busyWithPhoto }}
              style={styles.photoPress}
            >
              {photo === null ? (
                <View style={styles.monogram}>
                  <Text style={styles.monogramText}>{initials(name)}</Text>
                </View>
              ) : (
                /*
                  **`expo-image`, not React Native's `Image`, and the
                  difference is load-bearing.** This portrait is fetched from
                  an authenticated endpoint (ADR-0041 streams it rather than
                  publishing a URL), so the source carries an Authorization
                  header — and React Native's own `Image` silently drops it on
                  Android, answering every request with a 401 and drawing an
                  empty circle with nothing on screen to say why. The drawer
                  has always used this component and its avatar always worked;
                  that difference is how this was found. `contentFit` and the
                  fade match `DrawerContent`'s, so one face does not appear
                  two ways in two places.
                */
                <Image
                  source={authorizedImageSource(photo)}
                  style={styles.photo}
                  contentFit="cover"
                  transition={120}
                  accessibilityIgnoresInvertColors
                />
              )}

              {/*
                The badge is the affordance. A circular portrait with no mark
                does not read as tappable, and this is the one control on the
                screen whose target is a picture rather than a word.
              */}
              <View style={styles.photoBadge}>
                {busyWithPhoto ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <CameraIcon size={16} color={colors.onPrimary} strokeWidth={2.2} />
                )}
              </View>
            </Pressable>

            <View style={styles.identityText}>
              {editing === 'name' ? (
                <InlineEditor
                  label="Your name"
                  value={draft}
                  onChange={setDraft}
                  onCancel={cancelEdit}
                  onSave={() => void saveEdit('name')}
                  busy={updateProfile.isPending}
                  autoCapitalize="words"
                />
              ) : (
                <Pressable
                  onPress={() => beginEdit('name')}
                  accessibilityRole="button"
                  accessibilityLabel={`Your name, ${name}. Edit`}
                  style={styles.nameRow}
                >
                  <Text style={styles.name} numberOfLines={2}>
                    {name}
                  </Text>
                  <PencilIcon size={16} color={colors.textMuted} strokeWidth={2} />
                </Pressable>
              )}

              <View
                style={styles.ratingRow}
                accessible
                accessibilityLabel={`Rating ${ratingValue(stats)}. ${ratingNote(stats) ?? 'Not loaded yet'}. ${tripsTotal(profile)} completed.`}
              >
                <StarIcon size={18} />
                <Text style={styles.rating}>{ratingValue(stats)}</Text>
                {/*
                  The count is what makes an em dash legible while the score is
                  withheld — a bare dash invites a driver to assume the worst
                  about a number that can end their income.
                */}
                <Text style={styles.ratingNote} numberOfLines={1}>
                  {ratingNote(stats) ?? '—'} · {tripsTotal(profile)}
                </Text>
              </View>
            </View>
          </View>

          {photo !== null && !busyWithPhoto && (
            <Pressable
              onPress={confirmRemovePhoto}
              accessibilityRole="button"
              accessibilityLabel="Remove your photo"
              style={styles.removePhoto}
            >
              <Text style={styles.removePhotoLabel}>Remove photo</Text>
            </Pressable>
          )}

          <View style={styles.rule} />

          {editing === 'phone' ? (
            <InlineEditor
              label="Your phone number"
              value={draft}
              onChange={setDraft}
              onCancel={cancelEdit}
              onSave={() => void saveEdit('phone')}
              busy={updateProfile.isPending}
              keyboardType="phone-pad"
            />
          ) : (
            <EditableFact
              label="Phone"
              value={profile?.phone ?? '—'}
              onEdit={() => beginEdit('phone')}
            />
          )}

          {/*
            The three below are read-only, and the note says by whom. **This is
            the difference the rebuild is for**: a screen that simply omits an
            editing control reads as unfinished, where one that names the holder
            reads as deliberate. Each sentence is a fact about this platform —
            the licence is the compliance record the office verifies (ADR-0033),
            and the vehicle is a depot allocation.
          */}
          <Fact label="Vehicle" value={vehicleName(profile)} />
          <Fact label="Vehicle type" value={vehicleType(profile)} />
          <Fact label="Member since" value={monthYear(profile?.member_since)} />

          <Text style={styles.officeNote}>{OFFICE_MANAGED.vehicle}</Text>
        </Card>

        {/*
          Two named groups rather than one seven-row list. The split is the one
          `SettingsScreen` used and it is the reason its rows fit here without
          becoming a wall: above is **what a driver opens during a shift**,
          below is **what they open once a month**. `navigation/drawer.ts`
          splits its own rows on exactly this line.
        */}
        <Text style={styles.sectionTitle}>Work</Text>

        <Card style={styles.menu}>
          <MenuRow
            icon={<FileTextIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Vehicle & Documents"
            value={documents.label}
            tone={documents.tone}
            announcement={`Vehicle and documents. ${documents.label}.`}
            onPress={() => navigation.navigate('Documents')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon={<CalendarIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Time off"
            announcement="Time off. Ask the office for leave."
            onPress={() => navigation.navigate('TimeOff')}
          />
          <View style={styles.separator} />
          {/*
            Settling up is a request the office answers (ADR-0032), not a
            transfer, and it lives on the Wallet tab — so this points there
            rather than implying a payment rail that does not exist.
          */}
          <MenuRow
            icon={<WalletIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Settling up"
            value="Wallet"
            announcement="Settling up. Opens the wallet, where you ask the office to settle."
            onPress={() => navigation.getParent()?.navigate('Wallet')}
          />
        </Card>

        <Text style={styles.sectionTitle}>Account</Text>

        <Card style={styles.menu}>
          {/*
            **The mockup's row, and it now goes somewhere** (ADR-0042). It was
            deliberately absent until its backend existed, because a row that
            navigates nowhere is the dead surface `docs/screen-rules.md`
            refuses — and this one is about somebody's pay.
          */}
          <MenuRow
            icon={<BanknoteIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Bank Details"
            value={payoutSummary(payout)}
            announcement={`Bank details. ${payoutSummary(payout) ?? 'Not set'}.`}
            onPress={() => navigation.navigate('BankDetails')}
          />
          <View style={styles.separator} />
          {/*
            **The smaller answer to a phone that rings at the wrong moment**
            (ADR-0046 §3). Without this the only control a driver has is
            Android's own, which switches the whole `offers.v1` channel off —
            and with it the banner, the heads-up and any chance of noticing a
            job. That choice is silent, permanent and invisible to the office;
            a driver who makes it once appears to the fleet as somebody who
            stopped accepting work.

            So the row offers the part they actually want to change. The
            notification, the countdown and the vibration all stay.
          */}
          <SwitchRow
            icon={<BellIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Job offer sound"
            subtitle="Plays a ringtone when a job arrives. The alert still shows if you turn this off."
            value={ringtone}
            announcement={`Job offer sound. ${ringtone ? 'On' : 'Off'}. Plays a ringtone when a job arrives.`}
            onToggle={(next) => {
              setRingtone(next);
              void setRingtoneEnabled(next);
            }}
          />
          {/*
            **Only on Android 14 and above** (ADR-0049 §2), where the
            permission is genuinely missing. Below it, `USE_FULL_SCREEN_INTENT`
            is granted at install, and a row asking a driver to go and enable
            something they already have is an instruction that makes the app
            look broken.

            It was worded as an action rather than a state because nothing in
            the stack could read whether the permission was granted. That is
            no longer true — `modules/full-screen-intent` reads it — and the
            state now lives on `PermissionsScreen` with the other five.

            It sits under the ringtone switch on purpose: both are about how
            loudly a job is allowed to arrive, and a driver who has just turned
            the sound off is exactly the one who should see that the screen can
            still light up.
          */}
          {/*
            **One row for all six, replacing the single lock-screen row that
            used to sit here.**

            That row was one of six permissions the offer path depends on, and
            being the only one with a door made it look like the only one that
            could be wrong — a driver getting no work had no way to discover
            that notifications, "all the time" location or an OEM battery
            manager were the actual cause. `PermissionsScreen` names all six,
            says which are stopping jobs, and opens the right page for each.

            Shown on every platform, unlike its predecessor: the screen itself
            hides the two Android-only rows, and notifications, location and
            camera matter everywhere.
          */}
          <View style={styles.separator} />
          <MenuRow
            icon={<SmartphoneIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Permissions"
            subtitle="What this phone must allow so jobs can reach you."
            announcement="Permissions. What this phone must allow so jobs can reach you."
            onPress={() => navigation.navigate('Permissions')}
          />
          <View style={styles.separator} />
          <MenuRow
            icon={<LockIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Change password"
            onPress={() => navigation.navigate('ChangePassword')}
          />
          <View style={styles.separator} />
          {/*
            The parked queue, and the sync state around it. Always here rather
            than only when something is stuck: a driver who has never seen this
            row cannot go looking for it on the day their closing odometer is
            refused (ADR-0023 §6).
          */}
          <MenuRow
            icon={
              <AlertTriangleIcon
                color={parked.length > 0 ? colors.danger : colors.primary}
                size={22}
                strokeWidth={2}
              />
            }
            label="Updates & sync"
            value={
              parked.length > 0
                ? `${parked.length} ${parked.length === 1 ? 'needs' : 'need'} you`
                : 'Nothing stuck'
            }
            tone={parked.length > 0 ? 'danger' : 'muted'}
            announcement={
              parked.length > 0
                ? `Updates and sync. ${parked.length} ${parked.length === 1 ? 'update needs' : 'updates need'} your attention.`
                : 'Updates and sync. Nothing is stuck.'
            }
            onPress={() => navigation.navigate('SyncQueue')}
          />
        </Card>

        {/*
          **The mockup's danger zone, and it now goes somewhere** (ADR-0043).
          It was absent for several passes on `docs/screen-rules.md`'s rule
          against dead surfaces — a Delete that only appears to work is worse
          than no Delete — and the whole loop behind it is built: the request,
          the office queue that answers it, and the email that carries the
          answer back to somebody who by then cannot sign in.

          The row says **Delete account** because that is the word a driver
          arrives with. Everything past the tap says what actually happens: the
          account closes, the work history stays, because reproducible invoices
          are what this platform is for.
        */}
        <Text style={styles.sectionTitle}>Danger zone</Text>

        <Card style={styles.menu}>
          <MenuRow
            icon={<Trash2Icon color={colors.danger} size={22} strokeWidth={2} />}
            label="Delete account"
            value={closureRowValue(closure)}
            tone={closureRowValue(closure) === null ? 'muted' : 'danger'}
            announcement={
              closureRowValue(closure) === null
                ? 'Delete account. Asks the office to close it.'
                : 'Delete account. Your request is waiting for the office.'
            }
            onPress={() => navigation.navigate('CloseAccount')}
          />
        </Card>

        <LogOutButton onPress={confirmSignOut} busy={signingOut} />

        <Text style={styles.version}>KangaruRide {appVersion()}</Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * Log out, drawn like the drawer's Go Offline — a full-width tinted pill with
 * the glyph, not a list row. The two are the same *kind* of act (leaving), and
 * a driver who has learned one should recognise the other.
 *
 * Moved here whole when Settings was folded in, pill and confirmation both.
 * The dialog stays: a one-tap log out at the foot of a scroll is exactly where
 * a flicked thumb lands.
 */
function LogOutButton({ onPress, busy = false }: { onPress: () => void; busy?: boolean }) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log out"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.logout}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <LogOutIcon size={20} color={colors.danger} strokeWidth={2.2} />
        )}
        <Text style={styles.logoutLabel}>{busy ? 'Logging out…' : 'Log out'}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A fact the driver owns, with the pencil that says so.
 *
 * The whole row is the target rather than the glyph alone: 52pt is the driver
 * app's floor (`docs/screen-rules.md` §6) and a 16-point pencil is a quarter of
 * it, in a cradle, in sun.
 */
function EditableFact({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <Pressable
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Edit`}
      style={styles.fact}
    >
      <Text style={styles.factLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.factEditable}>
        <Text style={styles.factValue} numberOfLines={1}>
          {value}
        </Text>
        <PencilIcon size={16} color={colors.textMuted} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

/**
 * The row, while it is being changed.
 *
 * In place rather than in a modal: the driver is correcting one short string
 * they can already see, and a sheet would hide the value they are comparing
 * against. `autoFocus` opens the keyboard without a second tap, which on a
 * phone in a cradle is the difference between one-handed and not.
 */
function InlineEditor({
  label,
  value,
  onChange,
  onSave,
  onCancel,
  busy,
  ...inputProps
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
} & Pick<React.ComponentProps<typeof TextInput>, 'keyboardType' | 'autoCapitalize'>) {
  return (
    <View style={styles.editor}>
      <Text style={styles.editorLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        style={styles.editorInput}
        autoFocus
        editable={!busy}
        onSubmitEditing={onSave}
        returnKeyType="done"
        {...inputProps}
      />
      <View style={styles.editorActions}>
        <Button label="Cancel" tone="neutral" size="sm" onPress={onCancel} disabled={busy} />
        <Button label="Save" size="sm" onPress={onSave} busy={busy} />
      </View>
    </View>
  );
}

/**
 * Label left, value right, on one line.
 *
 * Deliberately **not** `DetailRow` from `ui/facts.tsx`, which is a different
 * shape for a different job: it carries a glyph and stacks the value under the
 * label, which is right for a pickup address read from a cradle and wrong for
 * four short facts a driver is scanning down.
 *
 * `accessible` on the wrapper composes the pair into one announcement, per
 * `docs/screen-rules.md` §6: without it a screen reader walks the labels and
 * then the values, and nothing tells the listener which belongs to which.
 */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.factLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  photoPress: {
    width: 72,
    height: 72,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  monogram: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: {
    ...typography.title,
    color: colors.primaryText,
  },
  photoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    // A ring in the card's own colour, so the badge reads as sitting on top of
    // the portrait rather than punched out of it.
    borderWidth: 2,
    borderColor: colors.surface,
  },
  removePhoto: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    // 52pt is the driver app's floor and this is a destructive control; the
    // padding buys the height rather than a fixed dimension, so the label can
    // grow in translation.
    paddingVertical: spacing.sm + 2,
    paddingRight: spacing.md,
    minHeight: 52,
    justifyContent: 'center',
  },
  removePhotoLabel: {
    ...typography.body,
    color: colors.danger,
  },
  identityText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
  },
  name: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.xs,
  },
  rating: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  ratingNote: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 52,
  },
  factEditable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 2,
  },
  factLabel: {
    ...typography.body,
    color: colors.textMuted,
    // Shrinkable, but half as fast as the value. A fixed label is a row that
    // breaks in the second country PRODUCT.md is built for.
    flexShrink: 1,
  },
  factValue: {
    ...typography.bodyStrong,
    color: colors.text,
    // The value yields first: a truncated "Toyota Wish · UBB 12…" still tells a
    // driver which car, where a truncated label tells them nothing about which
    // fact they are looking at.
    flexShrink: 2,
    textAlign: 'right',
  },
  officeNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  editor: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  editorLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  editorInput: {
    ...typography.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    // 48 matches `SocialButton`'s documented exception and clears the 44pt
    // platform floor; the field a driver types into must not be the one too
    // small to hit.
    minHeight: 48,
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  menu: {
    // The rows carry their own vertical padding, so the card only needs its
    // gutters — otherwise the first and last rows sit in a double margin.
    paddingVertical: spacing.xs,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginLeft: spacing.xs,
    // The body's `gap` already separates the blocks; this pulls the heading
    // back down onto the card it names, so it belongs to the group below it
    // rather than floating between two.
    marginBottom: -spacing.sm,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.dangerTint,
  },
  logoutLabel: {
    ...typography.button,
    color: colors.danger,
  },
  version: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    // Against the pill above it rather than a full step away: it is a footnote
    // to the screen, not another block in the stack.
    marginTop: -spacing.xs,
  },
});
