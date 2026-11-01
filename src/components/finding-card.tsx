import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Finding } from '@/types/finding';

type Props = {
  finding: Finding;
  onApprove: (finding: Finding) => void;
  onDismiss: (finding: Finding) => void;
  onOpen: (finding: Finding) => void;
};

const SWIPE_THRESHOLD = 120;

const LONG_TEXT = 140;
const WIDE_LAYOUT = 600;

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

export function FindingCard({ finding, onApprove, onDismiss, onOpen }: Props) {
  const { width } = useWindowDimensions();
  const [cardWidth, setCardWidth] = useState(0);
  const x = useSharedValue(0);

  const pan = usePanGesture({
    activeOffsetX: [-10, 10],
    onUpdate: (e) => {
      x.value = e.translationX;
    },
    onDeactivate: (e) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        x.value = withTiming(width * 1.5, { duration: 200 }, () => scheduleOnRN(onApprove, finding));
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        x.value = withTiming(-width * 1.5, { duration: 200 }, () => scheduleOnRN(onDismiss, finding));
      } else {
        x.value = withSpring(0);
      }
    },
  });

  const tap = useTapGesture({
    onDeactivate: (e) => {
      if (!e.canceled) scheduleOnRN(onOpen, finding);
    },
  });
  const gesture = useExclusiveGestures(pan, tap);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { rotate: `${interpolate(x.value, [-width, 0, width], [-12, 0, 12])}deg` },
    ],
  }));
  const approveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, SWIPE_THRESHOLD], [0, 1], 'clamp'),
  }));
  const dismissStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-SWIPE_THRESHOLD, 0], [1, 0], 'clamp'),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.card, cardStyle]}
        onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
        <ThemedView type="backgroundElement" style={styles.inner}>
          <Animated.View style={[styles.badge, styles.approveBadge, approveStyle]}>
            <ThemedText type="smallBold" style={styles.badgeText}>DRIFT</ThemedText>
          </Animated.View>
          <Animated.View style={[styles.badge, styles.dismissBadge, dismissStyle]}>
            <ThemedText type="smallBold" style={styles.badgeText}>NOT DRIFT</ThemedText>
          </Animated.View>

          <ThemedText type="smallBold" themeColor="textSecondary">
            PR #{finding.pr} · Issue #{finding.issue}
          </ThemedText>
          <ThemedText type="subtitle" style={styles.item}>
            {finding.item}
          </ThemedText>

          <View style={[styles.compare, cardWidth >= WIDE_LAYOUT && styles.compareWide]}>
            <View style={styles.column}>
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
            <View style={styles.column}>
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
    fontSize: 24,
    lineHeight: 30,
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
  badge: {
    position: 'absolute',
    top: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  approveBadge: {
    left: Spacing.three,
    backgroundColor: '#16a34a',
  },
  dismissBadge: {
    right: Spacing.three,
    backgroundColor: '#dc2626',
  },
  badgeText: {
    color: '#ffffff',
  },
});
