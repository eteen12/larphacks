import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FindingCard } from '@/components/finding-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import fakeFindings from '@/data/fake-findings.json';
import type { Finding } from '@/types/finding';

export default function InboxScreen() {
  const [findings, setFindings] = useState<Finding[]>(fakeFindings as Finding[]);
  const current = findings[0];

  const resolve = (finding: Finding) =>
    setFindings((all) => all.filter((f) => f.id !== finding.id));

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="subtitle">Triage inbox</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {findings.length} open · swipe right = drift, left = not drift, tap = talk
          </ThemedText>

          {current ? (
            <FindingCard
              key={current.id}
              finding={current}
              onApprove={resolve}
              onDismiss={resolve}
              onOpen={() => {}}
            />
          ) : (
            <ThemedText themeColor="textSecondary">All clear. Nothing to review.</ThemedText>
          )}
        </SafeAreaView>
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
  },
});
