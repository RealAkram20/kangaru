import { useQuery } from '@tanstack/react-query';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchLegalDocuments } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { Notice } from '../ui/components';
import { ChevronLeftIcon } from '../ui/icons';
import { SkeletonText } from '../ui/Skeleton';
import { colors, MIN_TOUCH_HEIGHT, spacing, typography } from '../ui/theme';

export type LegalDocument = 'terms' | 'privacy';

const TITLES: Record<LegalDocument, string> = {
  terms: 'Terms and Conditions',
  privacy: 'Privacy Policy',
};

/**
 * The consent documents, read in the app rather than in a browser.
 *
 * Handing these to `Linking.openURL` was the first shape and it was wrong on
 * two counts. It throws the driver out of a half-completed form into a browser,
 * and everything they had typed is at the mercy of Android deciding to reclaim
 * the app while they read. And it needs somewhere to send them — the pages did
 * not exist, and a consent box that requires agreement to two 404s cannot ship.
 *
 * So the text comes from the platform's own settings (ADR-0014, `legal` group),
 * which means the office can correct it from the settings screen without a
 * release, and the app has nothing hard-coded to go stale.
 *
 * The read is cached by the query client, which is persisted to AsyncStorage
 * for a day — so a driver who opened the terms once can open them again in a
 * dead zone. That is not incidental: the network they will most want to read
 * this on is the one outside a depot.
 */
export function LegalSheet({
  document,
  onClose,
}: {
  document: LegalDocument | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { api } = useAuth();

  const { data, isPending, isError } = useQuery({
    queryKey: ['legal-documents'],
    queryFn: () => fetchLegalDocuments(api),
    // Only once the driver has actually asked. The sign-up screen must not
    // spend a request on a document most people will never open.
    enabled: document !== null,
    staleTime: 60 * 60 * 1000,
  });

  return (
    <Modal
      visible={document !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.sheet, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={8}
            style={styles.back}
          >
            <ChevronLeftIcon color={colors.textBody} size={24} />
          </Pressable>

          <Text style={styles.title} numberOfLines={1}>
            {document === null ? '' : TITLES[document]}
          </Text>

          {/* Balances the back control so the title sits optically centred. */}
          <View style={styles.back} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
        >
          {/*
            These are pages of prose, so the placeholder is prose-shaped. The
            spinner it replaces gave no sense that a long document was on its
            way, on the one screen where that is the whole expectation.
          */}
          {isPending && <SkeletonText lines={8} style={styles.spinner} />}

          {isError && (
            <Notice
              tone="warning"
              message="These notices need a connection the first time."
            />
          )}

          {data !== undefined && document !== null && (
            <Text style={styles.prose}>{documentText(data[document])}</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * An administrator who clears the box in settings is not making a statement
 * about the law; they have almost certainly saved by accident. Saying so is
 * better than rendering nothing and letting a driver believe they have read
 * the terms.
 */
function documentText(text: string): string {
  return text.trim().length > 0
    ? text
    : 'Not published yet. Ask your fleet office for a copy.';
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: {
    width: MIN_TOUCH_HEIGHT,
    height: MIN_TOUCH_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.heading,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  body: {
    padding: spacing.lg,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  prose: {
    ...typography.body,
    color: colors.textBody,
    // Looser than the app's default: this is the only screen with more than a
    // sentence of continuous prose on it, and body leading tuned for form
    // labels is punishing to read at length.
    lineHeight: 26,
  },
});