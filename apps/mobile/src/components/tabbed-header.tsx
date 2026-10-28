import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UnderlineTabs } from '@/components/underline-tabs';
import { Spacing } from '@/constants/theme';

export type TabbedHeaderProps<T extends string> = {
  title: string;
  description: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Rendered to the right of the title, e.g. the current tab's add button. */
  actions?: ReactNode;
};

/** A top-level page's title, one-line description and sub-tabs. */
export function TabbedHeader<T extends string>({ title, description, options, value, onChange, actions }: TabbedHeaderProps<T>) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle">{title}</ThemedText>
          {actions}
        </View>
        <ThemedText themeColor="textSecondary">{description}</ThemedText>
      </View>
      <UnderlineTabs options={options} value={value} onChange={onChange} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
});
