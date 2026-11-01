import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DecisionSheet } from '@/components/decision-sheet';
import { FindingCard } from '@/components/finding-card';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { approveFinding, dismissFinding, type ApiResult } from '@/lib/findings-api';
import { removeFinding, setNotice, useFindingsStore } from '@/lib/findings-store';
import type { Choice } from '@/lib/swipe';
import type { Finding } from '@/types/finding';

type Decision = { finding: Finding; choice: Choice; text: string };

const TINTS = {
  light: { drift: '#bbf7d0', notDrift: '#d1d5db' },
  dark: { drift: '#14532d', notDrift: '#374151' },
};

function send({ finding, choice, text }: Decision): Promise<ApiResult<void>> {
  return choice === 'drift'
    ? approveFinding(finding.id, text)
    : dismissFinding(finding.id, text || undefined);
}

export default function FindingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const tints = TINTS[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const { findings, notice } = useFindingsStore();
  const finding = findings.find((f) => f.id === id);
  const next = findings.find((f) => f.id !== id);

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
  const [cardKey, setCardKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; decision: Decision } | null>(null);
  const inFlight = useRef(false);

  const returnCard = () => {
    dragX.set(0);
    setCardKey((k) => k + 1);
  };

  const goNext = (decided: Finding) => {
    const remaining = findings.filter((f) => f.id !== decided.id);
    removeFinding(decided.id);
    setSending(false);
    inFlight.current = false;
    dragX.set(0);
    const following = remaining[findings.findIndex((f) => f.id === decided.id)] ?? remaining[0];
    if (following) {
      router.replace({ pathname: '/finding/[id]', params: { id: following.id } });
    } else {
      router.back();
    }
  };

  // The card leaves right away. If the request fails it comes back with the error.
  const attempt = async (decision: Decision) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailure(null);
    setNotice(null);
    const result = await send(decision);
    if (result.ok) {
      goNext(decision.finding);
    } else if (result.error.kind === 'already-handled') {
      setNotice('Already handled.');
      goNext(decision.finding);
    } else {
      inFlight.current = false;
      setSending(false);
      setFailure({ message: result.error.message, decision });
      returnCard();
    }
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <Animated.View style={[styles.root, tintStyle]}>
        <SafeAreaView style={styles.safeArea}>
          <Pressable onPress={() => router.back()}>
            <ThemedText type="link">Back to inbox</ThemedText>
          </Pressable>

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

          {sending ? (
            <ThemedText themeColor="textSecondary">Sending…</ThemedText>
          ) : finding ? (
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
                onChoose={(target, picked) =>
                  picked === 'drift'
                    ? setChoice(picked)
                    : attempt({ finding: target, choice: picked, text: '' })
                }
              />
            </View>
          ) : (
            <ThemedText themeColor="textSecondary">This finding is no longer open.</ThemedText>
          )}
        </SafeAreaView>

        <DecisionSheet
          choice={choice}
          item={finding?.item ?? ''}
          onCancel={() => {
            setChoice(null);
            returnCard();
          }}
          onSend={(text) => {
            if (!finding || !choice) return;
            const decision = { finding, choice, text };
            setChoice(null);
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
  peek: {
    position: 'absolute',
    top: -10,
    left: Spacing.four,
    right: Spacing.four,
    height: 40,
    borderRadius: Spacing.four,
  },
  failure: {
    gap: Spacing.one,
  },
  error: {
    color: '#dc2626',
  },
});
