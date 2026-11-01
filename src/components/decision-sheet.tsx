import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { DRIFT_COLOR, NOT_DRIFT_COLOR } from '@/components/finding-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Choice } from '@/lib/swipe';

type Props = {
  choice: Choice | null;
  item: string;
  onCancel: () => void;
  onSend: (text: string) => void;
};

export function DecisionSheet({ choice, item, onCancel, onSend }: Props) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const drift = choice === 'drift';
  const canSend = !drift || text.trim().length > 0;

  const cancel = () => {
    setText('');
    onCancel();
  };
  const send = () => {
    if (!canSend) return;
    const value = text.trim();
    setText('');
    onSend(value);
  };

  return (
    <Modal visible={choice !== null} transparent animationType="slide" onRequestClose={cancel}>
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedView type="backgroundElement" style={styles.sheet}>
          <ThemedText type="smallBold">
            {drift ? 'What should change?' : 'Why is this fine? (optional)'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {item}
          </ThemedText>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={drift ? 'e.g. Set the refund window to 30 days' : 'e.g. The client confirmed this on a call'}
            placeholderTextColor={theme.textSecondary}
            multiline
            autoFocus
            style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
          />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={cancel}
              style={[styles.button, styles.cancel]}>
              <ThemedText type="smallBold">Cancel</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              onPress={send}
              disabled={!canSend}
              style={[
                styles.button,
                { backgroundColor: drift ? DRIFT_COLOR : NOT_DRIFT_COLOR },
                !canSend && styles.disabled,
              ]}>
              <ThemedText type="smallBold" style={styles.white}>
                Send
              </ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
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
  disabled: {
    opacity: 0.4,
  },
  white: {
    color: '#ffffff',
  },
});
