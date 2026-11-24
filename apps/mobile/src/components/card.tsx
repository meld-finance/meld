import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { WithTip, type Tip } from '@/components/info-tip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title?: string;
  subtitle?: string;
  /** A plain-words explanation behind an ⓘ next to the title. */
  tip?: Tip;
  action?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
};

export function Card({ title, subtitle, tip, action, children, style }: Props) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }, style]}>
      {(title || action) && (
        <View style={styles.header}>
          <View style={styles.titles}>
            {title && (
              <WithTip tip={tip}>
                <ThemedText type="cardTitle">{title}</ThemedText>
              </WithTip>
            )}
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
  header: { zIndex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  titles: { flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: Spacing.half },
});
