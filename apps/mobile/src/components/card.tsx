import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; style?: ViewStyle };

export function Card({ title, subtitle, action, children, style }: Props) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }, style]}>
      {(title || action) && (
        <View style={styles.header}>
          <View style={styles.titles}>
            {title && <ThemedText type="cardTitle">{title}</ThemedText>}
            {subtitle && (
              <ThemedText type="small" themeColor="textSecondary">
                {subtitle}
              </ThemedText>
            )}
          </View>
          {action}
        </View>
      )}
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.four, borderRadius: Spacing.three + Spacing.one, borderWidth: 1, gap: Spacing.three },
  // Above the body, so an open dropdown in `action` draws over it.
  header: { zIndex: 1, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  titles: { flexShrink: 1, gap: Spacing.half },
});
