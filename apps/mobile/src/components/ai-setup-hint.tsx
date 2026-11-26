import { router } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export type HintLink = { label: string; url: string };

/**
 * Shown where a feature needs cloud AI that isn't set up: what to do by hand now,
 * and how to have AI do it instead.
 */
export function AISetupHint({ manual, links = [], aiDoes }: { manual: string; links?: HintLink[]; aiDoes: string }) {
  return (
    <View style={styles.hint}>
      <ThemedText type="small" themeColor="textSecondary">
        {manual}
        {links.map((l, i) => (
          <Text key={l.url}>
            {i === 0 ? ' ' : ' · '}
            <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => void Linking.openURL(l.url)}>
              {l.label}
            </ThemedText>
          </Text>
        ))}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        ✨ To have AI {aiDoes}, add an Anthropic or OpenRouter API key in{' '}
        <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={() => router.push('/settings')}>
          Settings
        </ThemedText>
        .
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { gap: Spacing.one },
});
