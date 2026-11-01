import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { refreshFindings, useFindingsStore } from '@/lib/findings-store';

export default function InboxScreen() {
  const { findings, status, error, refreshing } = useFindingsStore();

  useEffect(() => {
    refreshFindings();
  }, []);

  const body = () => {
    if (status === 'loading') return <ActivityIndicator />;

    if (status === 'error') {
      const unauthorized = error?.kind === 'unauthorized';
      return (
        <View style={styles.center}>
          <ThemedText>{unauthorized ? 'Not allowed to load findings.' : 'Could not load findings.'}</ThemedText>
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

    return (
      <FlatList
        data={findings}
        keyExtractor={(f) => f.id}
        refreshing={refreshing}
        onRefresh={refreshFindings}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary">No drift. Nice.</ThemedText>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/finding/[id]', params: { id: item.id } })}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold">{item.item}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.kind === 'conflict' ? 'Conflict' : 'No source'} · Issue #{item.issue}
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
      />
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <ThemedText type="subtitle">Triage inbox</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {status === 'ready' ? `${findings.length} open` : ' '}
            </ThemedText>
          </View>
          {Platform.OS === 'web' ? (
            <Pressable onPress={refreshFindings}>
              <ThemedText type="link">Refresh</ThemedText>
            </Pressable>
          ) : null}
        </View>
        {body()}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  row: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  center: {
    gap: Spacing.two,
  },
});
