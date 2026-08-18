import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { colors } from '../ui/theme';
import { CitySkyline } from './CitySkyline';

/**
 * Why three pictures: KangaruRide is known locally as the delivery app, and
 * the third slide — the taxi — is the correction. The images carry that claim
 * on their own; there is deliberately no caption, no dots, no chrome. Just
 * the work, drifting past.
 */
const SLIDES = [
  {
    key: 'boda',
    source: require('../../assets/onboarding/boda.webp'),
    label: 'A KangaruRide boda rider on a branded motorcycle',
  },
  {
    key: 'courier',
    source: require('../../assets/onboarding/courier.webp'),
    label: 'A KangaruRide courier carrying a branded delivery box',
  },
  {
    key: 'taxi',
    source: require('../../assets/onboarding/taxi.webp'),
    label: 'A KangaruRide taxi driver at the wheel of a branded car',
  },
] as const;

const AUTO_ADVANCE_MS = 4000;
/** Long enough that letting go does not immediately yank the page away. */
const RESUME_AFTER_TOUCH_MS = 6000;

/** How far the white bleeds into each side of the picture. */
const FEATHER = 48;

const WHITE = colors.background;
const CLEAR = `${colors.background}00`;

export function HeroCarousel({ compact = false }: { compact?: boolean }) {
  const { height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  /**
   * The page width is the carousel's own measured width, never the window's.
   *
   * `pagingEnabled` snaps to multiples of the ScrollView's layout width, so a
   * slide sized to anything else lands progressively further off-centre with
   * every page — the welcome screen mounts this inside a padded column, and
   * sizing slides to the window there pushed the third slide 52dp right of
   * where the snap put the page. Measuring makes the component indifferent to
   * whatever its parent does with padding.
   */
  const [frameWidth, setFrameWidth] = useState(0);

  // Touch parks the auto-advance rather than killing it: somebody who swiped
  // once is looking, not opting out forever.
  const pausedUntil = useRef(0);
  const index = useRef(0);

  /**
   * A share of the screen rather than a fixed height — a 5" Tecno and a
   * Galaxy S24 turn up in the same fleet. `compact` is the welcome screen's
   * constraint: everything below the hero must fit without scrolling, so the
   * picture gives ground first.
   */
  const heroHeight = compact
    ? Math.max(120, Math.min(200, height * 0.21))
    : Math.max(150, Math.min(230, height * 0.26));

  useEffect(() => {
    let alive = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) {
        setReduceMotion(on);
      }
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    // Reduced motion stops the carousel moving on its own; it does not take
    // the swipe away — that would hide the taxi slide from exactly the people
    // most likely to rely on assistive settings.
    if (reduceMotion || frameWidth === 0) {
      return;
    }

    const timer = setInterval(() => {
      if (Date.now() < pausedUntil.current) {
        return;
      }

      index.current = (index.current + 1) % SLIDES.length;
      scrollRef.current?.scrollTo({ x: index.current * frameWidth, animated: true });
    }, AUTO_ADVANCE_MS);

    return () => clearInterval(timer);
  }, [reduceMotion, frameWidth]);

  const onTouch = useCallback(() => {
    pausedUntil.current = Date.now() + RESUME_AFTER_TOUCH_MS;
  }, []);

  const onSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pausedUntil.current = Date.now() + RESUME_AFTER_TOUCH_MS;

      if (frameWidth > 0) {
        index.current = Math.round(event.nativeEvent.contentOffset.x / frameWidth);
      }
    },
    [frameWidth],
  );

  return (
    <View
      style={{ height: heroHeight }}
      onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}
    >
      {/* Fixed while the riders slide past in front — background, not a slide. */}
      <CitySkyline />

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={onTouch}
        onMomentumScrollEnd={onSettled}
        // Native driver, which is why the parallax below moves on transform
        // only: it has to keep tracking the finger while the JS thread is
        // busy with whatever the screen underneath is doing.
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
      >
        {/* Nothing renders until the frame has been measured: a slide built on
            a guessed width would flash into the corrected one a frame later. */}
        {frameWidth > 0 &&
          SLIDES.map((slide, i) => (
          <View key={slide.key} style={{ width: frameWidth, height: heroHeight }}>
            <Animated.View
              style={[
                styles.slide,
                reduceMotion
                  ? null
                  : {
                      // The picture drifts at a third of the page speed, so
                      // the slides read as depth rather than a filmstrip.
                      transform: [
                        {
                          translateX: scrollX.interpolate({
                            inputRange: [
                              (i - 1) * frameWidth,
                              i * frameWidth,
                              (i + 1) * frameWidth,
                            ],
                            outputRange: [frameWidth * 0.33, 0, -frameWidth * 0.33],
                            extrapolate: 'clamp',
                          }),
                        },
                      ],
                    },
              ]}
            >
              <Image
                source={slide.source}
                style={styles.image}
                contentFit="contain"
                accessible
                accessibilityLabel={slide.label}
                transition={0}
              />
            </Animated.View>
          </View>
        ))}
      </Animated.ScrollView>

      {/* The feather. Four white gradients over the edges, so the photos
          dissolve into the page instead of ending at a visible rectangle —
          the screen reads as one surface, not as an image slot. `pointerEvents`
          off so the swipe still lands on the carousel underneath. */}
      <LinearGradient
        pointerEvents="none"
        colors={[WHITE, CLEAR]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.feather, { left: 0, width: FEATHER }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[CLEAR, WHITE]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.feather, { right: 0, width: FEATHER }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[WHITE, CLEAR]}
        style={[styles.featherRow, { top: 0, height: FEATHER / 2 }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[CLEAR, WHITE]}
        style={[styles.featherRow, { bottom: 0, height: FEATHER }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  image: {
    width: '90%',
    height: '100%',
  },
  feather: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  featherRow: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});