import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { swipeOutcome, type Choice } from '@/lib/swipe';
import type { Finding } from '@/types/finding';

type Props = {
  finding: Finding;
  onChoose: (finding: Finding, choice: Choice) => void;
  // Lets a screen follow the drag, for example to tint its background.
  dragX?: SharedValue<number>;
  disabled?: boolean;
};

export const DRIFT_COLOR = '#16a34a';
export const NOT_DRIFT_COLOR = '#6b7280';

const LONG_TEXT = 140;
const WIDE_LAYOUT = 600;
const PANEL_GAP = 16;
export const EXIT_MS = 250;

// The colored panel trails the card by about a card width, so the exit has to clear both.
export const exitDistance = (screenWidth: number) => screenWidth * 2.2;

function Field({ label, text, sub }: { label: string; text: string; sub?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > LONG_TEXT;

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText numberOfLines={isLong && !expanded ? 4 : undefined}>{text}</ThemedText>
      {isLong ? (
        <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
          <ThemedText type="link">{expanded ? 'Show less' : 'Show more'}</ThemedText>
        </Pressable>
      ) : null}
      {sub ? (
        <ThemedText type="small" themeColor="textSecondary">
          {sub}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function FindingCard({ finding, onChoose, dragX, disabled }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const ownX = useSharedValue(0);
  const x = dragX ?? ownX;
  const widthValue = useSharedValue(0);
  // Once the card starts leaving, a later cancel of the drag must not spring it back.
  const leaving = useSharedValue(false);
  const [cardWidth, setCardWidth] = useState(0);
  const reduceMotion = useReducedMotion();

  const pan = usePanGesture({
    enabled: !disabled,
    activeOffsetX: [-10, 10],
    onUpdate: (e) => {
      x.value = e.translationX;
    },
    onDeactivate: (e) => {
      if (leaving.value) return;
      const outcome = swipeOutcome(e.translationX, e.velocityX, widthValue.value);
      if (outcome) leaving.value = true;
      if (outcome === 'drift') {
        x.value = withTiming(exitDistance(screenWidth), { duration: EXIT_MS }, (finished) => {
          if (finished) scheduleOnRN(onChoose, finding, 'drift');
        });
      } else if (outcome === 'not_drift') {
        x.value = withTiming(-exitDistance(screenWidth), { duration: EXIT_MS }, (finished) => {
          if (finished) scheduleOnRN(onChoose, finding, 'not_drift');
        });
      } else {
        x.value = withSpring(0);
      }
    },
  });

  const moveStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      {
        rotate: `${reduceMotion ? 0 : interpolate(x.value, [-screenWidth, 0, screenWidth], [-12, 0, 12])}deg`,
      },
    ],
  }));
  // Swiping right drags a green panel in from the left, swiping left a gray one from the right.
  const driftPanelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, 40], [0, 1], 'clamp'),
  }));
  const notDriftPanelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-40, 0], [1, 0], 'clamp'),
  }));

  const panelOffset = cardWidth + PANEL_GAP;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, moveStyle]}
        onLayout={(e) => {
          setCardWidth(e.nativeEvent.layout.width);
          widthValue.value = e.nativeEvent.layout.width;
        }}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.panel,
            styles.driftPanel,
            { width: cardWidth, left: -panelOffset },
            driftPanelStyle,
          ]}>
          <ThemedText type="subtitle" style={styles.white}>
            ✓
          </ThemedText>
          <ThemedText type="smallBold" style={styles.white}>
            Drift
          </ThemedText>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.panel,
            styles.notDriftPanel,
            { width: cardWidth, right: -panelOffset },
            notDriftPanelStyle,
          ]}>
          <ThemedText type="subtitle" style={styles.white}>
            ✕
          </ThemedText>
          <ThemedText type="smallBold" style={styles.white}>
            Not drift
          </ThemedText>
        </Animated.View>

        <ThemedView type="backgroundElement" style={styles.inner}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            PR #{finding.pr} · Issue #{finding.issue}
          </ThemedText>
          <ThemedText type="subtitle" style={styles.item}>
            {finding.item}
          </ThemedText>

          <View style={[styles.compare, cardWidth >= WIDE_LAYOUT && styles.compareWide]}>
            <View style={cardWidth >= WIDE_LAYOUT && styles.column}>
              {finding.note_quote ? (
                <Field
                  label="Client said"
                  text={finding.note_quote}
                  sub={`${finding.note_path ?? 'unknown note'} · ${finding.note_date ?? 'date unknown'}`}
                />
              ) : (
                <Field label="Client said" text="No note backs this." />
              )}
            </View>
            <View style={cardWidth >= WIDE_LAYOUT && styles.column}>
              <Field label="Code does" text={finding.diff_line} />
            </View>
          </View>
          <Field label={`Issue #${finding.issue} says`} text={finding.issue_quote} />
          <ThemedText type="small" themeColor="textSecondary">
            {finding.kind === 'conflict' ? 'Conflict' : 'No source'} ·{' '}
            {Math.round(finding.confidence * 100)}% confident
          </ThemedText>

        </ThemedView>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
  },
  inner: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  item: {
    fontSize: 28,
    lineHeight: 34,
  },
  field: {
    gap: Spacing.one,
  },
  compare: {
    gap: Spacing.three,
  },
  compareWide: {
    flexDirection: 'row',
  },
  column: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  driftPanel: {
    backgroundColor: DRIFT_COLOR,
    alignItems: 'flex-end',
  },
  notDriftPanel: {
    backgroundColor: NOT_DRIFT_COLOR,
    alignItems: 'flex-start',
  },
  white: {
    color: '#ffffff',
  },
});
