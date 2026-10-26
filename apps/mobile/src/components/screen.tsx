import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

type Props = {
  title: string;
  /** Rendered to the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  /** Set false when the child manages its own scrolling (e.g. a FlatList). */
  scroll?: boolean;
  refreshControl?: ScrollViewProps['refreshControl'];
};

export function Screen({ title, actions, children, scroll = true, refreshControl }: Props) {
  const header = (
    <View style={styles.header}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {actions && <View style={styles.actions}>{actions}</View>}
    </View>
  );

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
            {header}
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.fill]}>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
