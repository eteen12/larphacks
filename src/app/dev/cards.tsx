import { Unmatched } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FindingCard } from '@/components/finding-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { cardStates } from '@/data/card-states';
import type { Finding } from '@/types/finding';

const SIZES = [
  { name: 'Phone 375', width: 375 },
  { name: 'Wide 900', width: 900 },
];

// A swiped card flies off, so remount it to bring it back.
function Frame({ finding, width }: { finding: Finding; width: number }) {
  const [round, setRound] = useState(0);
  const reset = () => setRound((n) => n + 1);

  return (
    <View style={{ width }}>
      <FindingCard
        key={round}
        finding={finding}
        onChoose={reset}
      />
    </View>
  );
}

export default function CardsDevPage() {
  if (!__DEV__) return <Unmatched />;

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedText type="subtitle">Card states</ThemedText>
            {cardStates.map(({ label, finding }) => (
              <View key={finding.id} style={styles.section}>
                <ThemedText type="smallBold">{label}</ThemedText>
                {SIZES.map(({ name, width }) => (
                  <View key={name} style={styles.section}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {name}
                    </ThemedText>
                    <ScrollView horizontal>
                      <Frame finding={finding} width={width} />
                    </ScrollView>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
});
