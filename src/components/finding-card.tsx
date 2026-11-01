import { StyleSheet, View, useWindowDimensions } from 'react-native';
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

function Field({ label, text, sub }: { label: string; text: string; sub?: string }) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText>{text}</ThemedText>
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
      <Animated.View style={[styles.card, cardStyle]}>
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

          <Field
            label="Issue says"
            text={finding.issue_quote}
          />
          {finding.note_quote ? (
            <Field
              label="Client note"
              text={finding.note_quote}
              sub={`${finding.note_path} · ${finding.note_date}`}
            />
          ) : (
            <Field label="Client note" text="No note supports this decision." />
          )}
          <Field label="Code" text={finding.diff_line} />
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
