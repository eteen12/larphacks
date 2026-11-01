import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { DecisionSheet } from '@/components/decision-sheet';
import { DRIFT_COLOR, EXIT_MS, FindingCard } from '@/components/finding-card';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { approveFinding, dismissFinding, type ApiResult } from '@/lib/findings-api';
import {
  refreshFindings,
  removeFinding,
  setNotice,
  useFindingsStore,
} from '@/lib/findings-store';
import type { Choice } from '@/lib/swipe';
import type { Finding } from '@/types/finding';

const SHEET_DELAY_MS = 150;

type Decision = { finding: Finding; choice: Choice; text: string };

const TINTS = {
  light: { drift: '#bbf7d0', notDrift: '#d1d5db' },
  dark: { drift: '#14532d', notDrift: '#374151' },
};

function send({ finding, choice, text }: Decision): Promise<ApiResult<void>> {
  return choice === 'drift' ? approveFinding(finding.id, text) : dismissFinding(finding.id);
}

export default function CardScreen() {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const tints = TINTS[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const { findings, status, error, notice } = useFindingsStore();
  const finding = findings[0];
  const next = findings[1];

  const dragX = useSharedValue(0);
  const background = theme.background;
  const tintStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      dragX.value,
      [-150, 0, 150],
      [tints.notDrift, background, tints.drift],
    ),
  }));

  const [choice, setChoice] = useState<Choice | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cardKey, setCardKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; decision: Decision } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    refreshFindings();
  }, []);

  const returnCard = () => {
    dragX.set(0);
    setCardKey((k) => k + 1);
  };

  // The card leaves right away. If the request fails it comes back with the error.
  const attempt = async (decision: Decision) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailure(null);
    setNotice(null);
    const result = await send(decision);
    if (result.ok || result.error.kind === 'already-handled') {
      if (!result.ok) setNotice('Already handled.');
      removeFinding(decision.finding.id);
      inFlight.current = false;
      setSending(false);
      dragX.set(0);
    } else {
      inFlight.current = false;
      setSending(false);
      setFailure({ message: result.error.message, decision });
      returnCard();
    }
  };

  const onChosen = (target: Finding, picked: Choice) => {
    if (picked === 'drift') {
      // Lock the card now, but let it settle off screen before the sheet slides up.
      setChoice(picked);
      setTimeout(() => setSheetOpen(true), SHEET_DELAY_MS);
    } else attempt({ finding: target, choice: picked, text: '' });
  };

  // The buttons run the same exit as a full swipe.
  const choose = (picked: Choice) => {
    if (!finding || choice !== null || sending) return;
    const sign = picked === 'drift' ? 1 : -1;
    dragX.set(
      withTiming(sign * screenWidth * 1.5, { duration: EXIT_MS }, (finished) => {
        if (finished) scheduleOnRN(onChosen, finding, picked);
      }),
    );
  };

  const canChoose = status === 'ready' && !!finding && !sending && choice === null;

  const body = () => {
    if (status === 'loading') return <ActivityIndicator />;

    if (status === 'error') {
      const unauthorized = error?.kind === 'unauthorized';
      return (
        <View style={styles.center}>
          <ThemedText>
            {unauthorized ? 'Not allowed to load findings.' : 'Could not load findings.'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {unauthorized
              ? 'The server rejected the API key. Check EXPO_PUBLIC_FINDINGS_API_KEY.'
              : error?.message}
          </ThemedText>
          <Pressable onPress={refreshFindings}>
            <ThemedText type="link">Retry</ThemedText>
          </Pressable>
        </View>
      );
    }

    if (sending) return <ThemedText themeColor="textSecondary">Sending…</ThemedText>;

    if (!finding) return <ThemedText themeColor="textSecondary">No drift. Nice.</ThemedText>;

    return (
      <View>
        {next ? (
          <View
            style={[styles.peek, { backgroundColor: theme.backgroundSelected }]}
            pointerEvents="none"
          />
        ) : null}
        <FindingCard
          key={`${finding.id}-${cardKey}`}
          finding={finding}
          dragX={dragX}
          disabled={choice !== null}
          onChoose={onChosen}
        />
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <Animated.View style={[styles.root, tintStyle]}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <ThemedText type="subtitle">Open</ThemedText>
              <ThemedText type="subtitle" themeColor="textSecondary">
                {status === 'ready' ? findings.length : ''}
              </ThemedText>
            </View>
            <Pressable
              onPress={refreshFindings}
              style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">Refresh</ThemedText>
            </Pressable>
          </View>

          {notice ? (
            <ThemedText type="small" themeColor="textSecondary">
              {notice}
            </ThemedText>
          ) : null}

          {failure ? (
            <View style={styles.failure}>
              <ThemedText type="small" style={styles.error}>
                {failure.message}
              </ThemedText>
              <Pressable onPress={() => attempt(failure.decision)}>
                <ThemedText type="link">Retry</ThemedText>
              </Pressable>
            </View>
          ) : null}

          <ScrollView style={styles.root} contentContainerStyle={styles.cardArea}>
            {body()}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Not drift"
              disabled={!canChoose}
              onPress={() => choose('not_drift')}
              style={[
                styles.action,
                { backgroundColor: theme.backgroundElement },
                !canChoose && styles.disabled,
              ]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                ✕
              </ThemedText>
              <ThemedText type="smallBold">Not drift</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Drift"
              disabled={!canChoose}
              onPress={() => choose('drift')}
              style={[
                styles.action,
                { backgroundColor: theme.backgroundElement },
                !canChoose && styles.disabled,
              ]}>
              <ThemedText type="smallBold" style={{ color: DRIFT_COLOR }}>
                ✓
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: DRIFT_COLOR }}>
                Drift
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>

        <DecisionSheet
          choice={sheetOpen ? choice : null}
          item={finding?.item ?? ''}
          onCancel={() => {
            setChoice(null);
            setSheetOpen(false);
            returnCard();
          }}
          onSend={(text) => {
            if (!finding || !choice) return;
            const decision = { finding, choice, text };
            setChoice(null);
            setSheetOpen(false);
            attempt(decision);
          }}
        />
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  cardArea: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingVertical: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  peek: {
    position: 'absolute',
    top: -10,
    left: Spacing.four,
    right: Spacing.four,
    height: 40,
    borderRadius: Spacing.four,
  },
  center: {
    gap: Spacing.two,
  },
  failure: {
    gap: Spacing.one,
  },
  error: {
    color: '#dc2626',
  },
});
