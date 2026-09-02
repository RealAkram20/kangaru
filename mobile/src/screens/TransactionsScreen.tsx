import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { WalletStackParams } from '../navigation/types';
import { Screen, ScreenHeader } from '../ui/components';
import { SkeletonRows } from '../ui/Skeleton';
import { colors, radius, spacing, typography } from '../ui/theme';
import { StatementRow } from '../wallet/StatementRow';
import {
  customRange,
  dateButtonLabel,
  emptyRangeMessage,
  presetLabel,
  presetRange,
  type RangePreset,
} from '../wallet/settlement';
import { useDriverLedger } from '../wallet/queries';

type Props = NativeStackScreenProps<WalletStackParams, 'Transactions'>;

const PRESETS: readonly RangePreset[] = ['today', 'week', 'custom'] as const;

/**
 * The whole statement, filtered by date — where *View all* goes.
 *
 * The wallet screen shows the balance and the last few movements; this is
 * everything, cursor-paginated, with **Today / This week / Custom** over it.
 *
 * ## Why the filtering is server-side
 *
 * The obvious cheap version filters the pages already fetched. It is wrong
 * here: the ledger is paginated, so a client-side filter can only ever search
 * what happens to have been scrolled into memory — a driver picking "1 August"
 * on a page that starts at the 14th would be told there was nothing, which is
 * the most confident possible way to be wrong. The range goes to the server
 * and is part of the query key, so each filter holds its own cached pages.
 *
 * ## The dates are whole local days, at both ends
 *
 * `to` is **inclusive**: picking 15 August for both ends returns the whole of
 * that day rather than nothing, which is the first thing anybody tries. The
 * server measures the day in the *fleet's* timezone rather than the handset's,
 * so a driver near a border does not see their day move.
 */
export function TransactionsScreen({ navigation }: Props) {
  const [preset, setPreset] = useState<RangePreset>('today');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  const range = useMemo(
    () => (preset === 'custom' ? customRange(from, to) : presetRange(preset)),
    [preset, from, to],
  );

  const ledger = useDriverLedger(range);
  const entries = ledger.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <Screen>
      <ScreenHeader title="Transactions" subtitle={null} onBack={() => navigation.goBack()} />

      <View style={styles.filters}>
        <View style={styles.chips} accessibilityRole="tablist">
          {PRESETS.map((option) => {
            const selected = option === preset;

            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={presetLabel(option)}
                onPress={() => setPreset(option)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                  {presetLabel(option)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {preset === 'custom' && (
          <View style={styles.dateRow}>
            <DateButton
              label="From"
              value={from}
              onPress={() => setPicking('from')}
            />
            <DateButton label="To" value={to} onPress={() => setPicking('to')} />
          </View>
        )}
      </View>

      {picking !== null && (
        <DateTimePicker
          // The one `testID` in this app. The picker is a native module with
          // no text and no accessible name of its own — the calendar is the
          // platform's — so there is nothing else to find it by, and what a
          // test needs to assert is what this screen does with the answer.
          testID="range-picker"
          value={(picking === 'from' ? from : to) ?? new Date()}
          mode="date"
          // A ledger has no future. Letting somebody scroll into next month
          // and get an empty list is a question the control can simply not
          // ask.
          maximumDate={new Date()}
          /*
            `onValueChange` + `onDismiss`. `onChange` is deprecated in
            datetimepicker 9 and warns on every open; the split also removes the
            Android trap this call site used to hand-check — a cancel arrived as
            a change event carrying the unchanged value, and treating it as a
            pick silently set a date the driver had rejected. See
            `DocumentsScreen`, which had the same handler and the same trap.
          */
          onValueChange={(_event, selected) => {
            const which = picking;

            setPicking(null);

            if (which === 'from') {
              setFrom(selected);
            } else {
              setTo(selected);
            }
          }}
          onDismiss={() => setPicking(null)}
        />
      )}

      <FlatList
        data={entries}
        keyExtractor={(entry) => String(entry.id)}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        // Only what fills the first screen mounts during the push; the rest
        // renders once the slide is over, in small batches the JS thread can
        // fit between frames. Rows are one shape, so a small window has no gaps.
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        renderItem={({ item }) => <StatementRow entry={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          ledger.isLoading ? (
            <SkeletonRows count={5} style={styles.loading} />
          ) : (
            <Text style={styles.empty}>{emptyRangeMessage(preset)}</Text>
          )
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (ledger.hasNextPage && !ledger.isFetchingNextPage) {
            void ledger.fetchNextPage();
          }
        }}
        ListFooterComponent={
          ledger.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : null
        }
        refreshing={ledger.isRefetching && !ledger.isFetchingNextPage}
        onRefresh={() => void ledger.refetch()}
      />
    </Screen>
  );
}

/**
 * One end of a custom range.
 *
 * The value is in the accessible name as well as on screen — "From, 15 Aug
 * 2026" — because a button reading only "From" tells a screen reader nothing
 * about what is currently selected, which is the whole state of this control.
 */
function DateButton({
  label,
  value,
  onPress,
}: {
  label: string;
  value: Date | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${dateButtonLabel(value)}`}
      onPress={onPress}
      style={styles.dateButton}
    >
      <Text style={styles.dateLabel}>{label}</Text>
      <Text style={styles.dateValue}>{dateButtonLabel(value)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  chip: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  chipSelected: {
    // `primaryCta`, not `primary`: white on `primary` is 4.15:1 and fails AA
    // for a label this size.
    backgroundColor: colors.primaryCta,
  },
  chipLabel: {
    ...typography.label,
    color: colors.textBody,
  },
  chipLabelSelected: {
    color: colors.onPrimary,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateButton: {
    flex: 1,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dateLabel: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
  dateValue: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    paddingVertical: spacing.lg,
  },
  loading: {
    paddingVertical: spacing.lg,
  },
});
