import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/** A filled check once a transaction's category is verified; an empty ring while it still needs a look. */
export function VerifiedMark({ verified, size = 18 }: { verified: boolean; size?: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={verified ? 'Category verified' : 'Category not verified'}
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size / 2 },
        verified ? { backgroundColor: theme.positive, borderColor: theme.positive } : { borderColor: theme.textSecondary, opacity: 0.5 },
      ]}>
      {verified && (
        <ThemedText style={[styles.check, { fontSize: size * 0.6, lineHeight: size * 0.75 }]}>✓</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  check: { color: '#ffffff', fontWeight: '700' },
});
