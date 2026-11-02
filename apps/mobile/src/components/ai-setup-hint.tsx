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
        ✨ To have AI {aiDoes}, add an Anthropic API key (<ThemedText type="code">ANTHROPIC_API_KEY</ThemedText> in{' '}
        <ThemedText type="code">.env</ThemedText>) and restart Meld.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { gap: Spacing.one },
});
