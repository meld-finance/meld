import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

export default function LoginScreen() {
  const theme = useTheme();
  const { login } = useAuth();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!passphrase || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(passphrase);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.container}>
        <View style={styles.brand}>
          <Logo size={40} />
          <ThemedText type="subtitle">Meld</ThemedText>
        </View>
        <ThemedText themeColor="textSecondary">Your whole financial picture.</ThemedText>

        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          placeholder="Passphrase"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          autoFocus
          value={passphrase}
          onChangeText={setPassphrase}
          onSubmitEditing={submit}
        />
        {error && <ThemedText themeColor="negative">{error}</ThemedText>}

        <Pressable
          onPress={submit}
          disabled={!passphrase || submitting}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.text, opacity: !passphrase || pressed ? 0.6 : 1 },
          ]}>
          {submitting ? (
            <ActivityIndicator color={theme.background} />
          ) : (
            <ThemedText style={{ color: theme.background }}>Unlock</ThemedText>
          )}
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
