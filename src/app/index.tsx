import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FindingCard } from '@/components/finding-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  approveFinding,
  dismissFinding,
  fetchOpenFindings,
  type ApiResult,
} from '@/lib/findings-api';
import type { Finding } from '@/types/finding';

export default function InboxScreen() {
  const theme = useTheme();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [cardKey, setCardKey] = useState(0);
  const [approving, setApproving] = useState<Finding | null>(null);
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);

  const applyLoad = (result: ApiResult<Finding[]>) => {
    if (result.ok) {
      setFindings(result.data);
      setMessage(null);
    } else {
      setMessage(result.error.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOpenFindings().then(applyLoad);
  }, []);

  // A handled finding leaves. Any other failure brings the card back with the error.
  const finish = (finding: Finding, result: ApiResult<void>) => {
    if (result.ok || result.error.kind === 'already-handled') {
      setFindings((all) => all.filter((f) => f.id !== finding.id));
      setMessage(result.ok ? null : result.error.message);
      return;
    }
    setMessage(result.error.message);
    setCardKey((k) => k + 1);
  };

  const closeSheet = () => {
    setApproving(null);
    setInstruction('');
  };

  const cancelApprove = () => {
    closeSheet();
    setCardKey((k) => k + 1);
  };

  const submitApprove = async () => {
    if (!approving || sending) return;
    setSending(true);
    const result = await approveFinding(approving.id, instruction);
    setSending(false);
    finish(approving, result);
    closeSheet();
  };

  const current = findings[0];

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="subtitle">Triage inbox</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {findings.length} open · swipe right = drift, left = not drift
          </ThemedText>

          {message ? (
            <ThemedText type="small" style={styles.error}>
              {message}
            </ThemedText>
          ) : null}

          {loading ? (
            <ActivityIndicator />
          ) : current ? (
            <FindingCard
              key={`${current.id}-${cardKey}`}
              finding={current}
              onApprove={setApproving}
              onDismiss={async (finding) => finish(finding, await dismissFinding(finding.id))}
              onOpen={() => {}}
            />
          ) : (
            <View style={styles.empty}>
              <ThemedText themeColor="textSecondary">
                {message ? 'Could not load findings.' : 'All clear. Nothing to review.'}
              </ThemedText>
              {message ? (
                <Pressable
                  onPress={() => {
                    setLoading(true);
                    fetchOpenFindings().then(applyLoad);
                  }}>
                  <ThemedText type="link">Try again</ThemedText>
                </Pressable>
              ) : null}
            </View>
          )}
        </SafeAreaView>

        <Modal visible={!!approving} transparent animationType="slide" onRequestClose={cancelApprove}>
          <KeyboardAvoidingView
            style={styles.sheetWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ThemedView type="backgroundElement" style={styles.sheet}>
              <ThemedText type="smallBold">What should change?</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {approving?.item}
              </ThemedText>
              <TextInput
                value={instruction}
                onChangeText={setInstruction}
                placeholder="e.g. Set the refund window to 30 days"
                placeholderTextColor={theme.textSecondary}
                multiline
                autoFocus
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <View style={styles.row}>
                <Pressable onPress={cancelApprove} style={[styles.button, styles.cancel]}>
                  <ThemedText type="smallBold">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={submitApprove}
                  disabled={!instruction.trim() || sending}
                  style={[
                    styles.button,
                    styles.send,
                    (!instruction.trim() || sending) && styles.disabled,
                  ]}>
                  <ThemedText type="smallBold" style={styles.white}>
                    {sending ? 'Sending…' : 'Approve'}
                  </ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </KeyboardAvoidingView>
        </Modal>
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
  error: {
    color: '#dc2626',
  },
  empty: {
    gap: Spacing.two,
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  input: {
    minHeight: 96,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  button: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  cancel: {
    backgroundColor: 'rgba(128,128,128,0.25)',
  },
  send: {
    backgroundColor: '#16a34a',
  },
  disabled: {
    opacity: 0.4,
  },
  white: {
    color: '#ffffff',
  },
});
