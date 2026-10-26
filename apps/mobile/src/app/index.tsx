import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Placeholder home until the dashboard lands in Phase 3.
export default function HomeScreen() {
  const { logout } = useAuth();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ ok: boolean }>('/health') });

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.container}>
        <ThemedText type="subtitle">Meld</ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">API status</ThemedText>
          <ThemedText themeColor="textSecondary">
            {health.isPending ? 'Checking…' : health.data?.ok ? 'Connected' : `Unavailable: ${health.error?.message}`}
          </ThemedText>
        </ThemedView>
        <Pressable onPress={logout}>
          <ThemedText type="linkPrimary">Lock</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
});
