import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, WideContentWidth } from '@/constants/theme';

type Props = {
  /** Omit to render the screen's own header inside `children`. */
  title?: string;
  /** Rendered to the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  /** Set false when the child manages its own scrolling (e.g. a FlatList). */
  scroll?: boolean;
  refreshControl?: ScrollViewProps['refreshControl'];
  /** Use the wider dashboard column. */
  wide?: boolean;
};

export function Screen({ title, actions, children, scroll = true, refreshControl, wide }: Props) {
  const header = (title || actions) && (
    <View style={styles.header}>
      {title && <ThemedText type="subtitle">{title}</ThemedText>}
      {actions && <View style={styles.actions}>{actions}</View>}
    </View>
  );
  const content = [styles.content, wide && styles.wide];

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        {scroll ? (
          <ScrollView contentContainerStyle={content} refreshControl={refreshControl}>
            {header}
            {children}
          </ScrollView>
        ) : (
          <View style={[content, styles.fill]}>
            {header}
            {children}
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  wide: { maxWidth: WideContentWidth },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
