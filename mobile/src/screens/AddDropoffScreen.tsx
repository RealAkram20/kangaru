import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addTripStop } from '../api/endpoints';
import { refusalMessage } from '../api/errors';
import type { PlaceSuggestion, TripStopCandidate } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import type { TripsStackParams } from '../navigation/types';
import { usePlaceSuggestions, useTrip, useTripStopCandidates } from '../trips/queries';
import { IconField, Notice, Screen, ScreenHeader } from '../ui/components';
import { CirclePlusIcon, MapPinIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'AddDropoff'>;

/**
 * The next drop-off, searched and added mid-run (ADR-0045 §4).
 *
 * The bank circuit is the whole reason this screen exists: one driver, five
 * ATMs and branches, served one at a time, and the next site decided in the
 * car. The search is the client's **own place register** (§10) — the estate
 * the client pinned themselves, which is authoritative in a way no public
 * geocoder is for "Ntinda ATM" — and, since the owner's 2026-08-22 decision,
 * **a public geocoder underneath it** for the site nobody has pinned. §10's
 * privacy shape survives: the handset asks this platform's own API, the
 * *server* asks the geocoder (`PlaceSuggestionService`), no key ships in this
 * bundle and no third party learns which driver or trip is asking.
 *
 * ## Three ways out, all one tap
 *
 * - **A saved place.** Sends the id alone; the server copies the label and
 *   pin from the register, so this handset cannot mislabel an ATM.
 * - **A suggestion.** Sends the geocoder's label and pin, so the map and the
 *   day's record know where the run actually went.
 * - **What was typed.** A label-only stop. It renders as prose on the
 *   itinerary and the map keeps its previous target — never a guessed pin.
 *
 * ## A direct POST, deliberately outside the outbox
 *
 * The search needs connectivity anyway, so a dead zone closes the whole flow
 * rather than half of it, and the refusal is shown here — where the driver
 * still has the context — rather than parked hours later. The
 * arrive/continue taps, which bear billing evidence, stay queued (ADR-0023).
 *
 * ## Walk-in trips
 *
 * No tenant, no register: that question is not even asked (`useTrip` knows).
 * The geocoder *is* asked — a walk-in passenger's "next stop" is exactly the
 * unpinned site the follow-up exists for — so the screen is suggestions plus
 * the free-text row.
 */
export function AddDropoffScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { api } = useAuth();
  const queryClient = useQueryClient();

  const { data: trip } = useTrip(tripId);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // A walk-in has no register at all, so the question is not asked — the
  // free-text row is that trip's whole flow. A corporate trip asks straight
  // away, empty query included: the driver opens this screen to pick the next
  // ATM off their own client's estate, and that should be one tap.
  const corporate = trip !== undefined && trip.tenant_id !== null;
  const candidates = useTripStopCandidates(tripId, query, corporate);
  const suggestions = usePlaceSuggestions(tripId, query);

  const trimmed = query.trim();

  const add = async (
    input: { clientPlaceId: number } | { label: string; latitude?: number; longitude?: number },
  ) => {
    setBusy(true);
    setRefusal(null);

    try {
      await addTripStop(api, tripId, input);
      // The trip payload carries the itinerary, and the route endpoint now
      // targets the new stop — one prefix covers the trip, its route and
      // this screen's own search.
      await queryClient.invalidateQueries({ queryKey: ['trips', tripId] });
      navigation.goBack();
    } catch (error) {
      setRefusal(
        refusalMessage(
          error,
          "You're offline, so the drop-off could not be added. Try again in coverage.",
        ),
      );
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Add a drop-off"
        subtitle={trip === undefined ? null : `Trip to ${trip.dropoff.label}`}
        onBack={() => navigation.goBack()}
      />

      <View style={styles.search}>
        <IconField
          icon={({ color }) => <MapPinIcon color={color} size={18} strokeWidth={2} />}
          placeholder={corporate ? 'Search saved places, or type it' : 'Type the next drop-off'}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          editable={!busy}
        />
      </View>

      {refusal !== null && <Notice tone="danger" message={refusal} />}

      <ScrollView
        contentContainerStyle={styles.results}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/*
          The register's answer, when there is a register and a question. A
          failed search is a notice, not a dead end — the free-text row below
          keeps working, and saying why the list is empty stops a driver
          re-typing an ATM name that was never going to appear.
        */}
        {candidates.isError && (
          <Notice message="Saved places are unreachable right now. You can still add what you typed." />
        )}

        {/*
          Named, because an unheaded list of place names on open reads as
          suggestions the app invented. These are the client's own pins, and
          saying so is what makes the first tap obvious.
        */}
        {(candidates.data ?? []).length > 0 && (
          <Text style={styles.section}>
            {trimmed === '' ? 'Saved places' : 'Matching saved places'}
          </Text>
        )}

        {(candidates.data ?? []).map((place) => (
          <CandidateRow key={place.id} place={place} disabled={busy} onPress={() => void add({ clientPlaceId: place.id })} />
        ))}

        {corporate &&
          trimmed !== '' &&
          candidates.isSuccess &&
          (candidates.data ?? []).length === 0 && (
            <Text style={styles.empty}>No saved place matches.</Text>
          )}

        {/*
          The geocoder's answer, under the register's and over the free-text
          row — that order is the trust order. Headed like the register list,
          and for the same reason: an unheaded run of place names reads as one
          list, and these two lists carry different authority. Failures are
          silent by design — the server already degrades to an empty list, and
          the free-text row underneath is the floor that never goes away.
        */}
        {(suggestions.data ?? []).length > 0 && (
          <Text style={styles.section}>Suggestions</Text>
        )}

        {(suggestions.data ?? []).map((place) => (
          <SuggestionRow
            key={`${place.latitude},${place.longitude},${place.name}`}
            place={place}
            disabled={busy}
            onPress={() =>
              void add({
                label: place.name,
                latitude: place.latitude,
                longitude: place.longitude,
              })
            }
          />
        ))}

        {/*
          Nothing to offer and nothing typed: a walk-in trip, a client with an
          empty register, or a search still in flight. The screen must still
          say what it wants — an empty page under a search box is a screen a
          driver backs out of.
        */}
        {trimmed === '' && (candidates.data ?? []).length === 0 && !candidates.isLoading && (
          <Text style={styles.empty}>Type where you are going next.</Text>
        )}

        {trimmed !== '' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${trimmed} as the next drop-off`}
            disabled={busy}
            onPress={() => void add({ label: trimmed })}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.glyph}>
              <CirclePlusIcon color={colors.primaryText} size={18} strokeWidth={2} />
            </View>
            <View style={styles.text}>
              <Text style={styles.label} numberOfLines={2}>
                Add “{trimmed}”
              </Text>
              {/* Said now, not discovered on the map: a typed stop has no pin,
                  so Navigate keeps its previous target. */}
              <Text style={styles.caption}>As typed — no map pin</Text>
            </View>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * A geocoder row — the same shape as a register row, deliberately: the
 * section heading is what carries the difference in authority, and a second
 * visual language for "a place you can tap" would make the driver learn two.
 */
function SuggestionRow({
  place,
  disabled,
  onPress,
}: {
  place: PlaceSuggestion;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${place.name} as the next drop-off`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.glyph}>
        <MapPinIcon color={colors.primaryText} size={18} strokeWidth={2} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {place.name}
        </Text>
        {place.detail !== null && (
          <Text style={styles.caption} numberOfLines={1}>
            {place.detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function CandidateRow({
  place,
  disabled,
  onPress,
}: {
  place: TripStopCandidate;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${place.name} as the next drop-off`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.glyph}>
        <MapPinIcon color={colors.primaryText} size={18} strokeWidth={2} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {place.name}
        </Text>
        {place.address !== null && (
          <Text style={styles.caption} numberOfLines={1}>
            {place.address}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  results: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // The row posts nothing, but it commits a destination — the same class
    // of tap as a transition, so the same 52pt floor.
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.body,
    color: colors.primaryText,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  section: {
    ...typography.captionStrong,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  empty: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
