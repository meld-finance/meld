import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** '' → null; otherwise a non-negative number, or undefined when unreadable. */
export function parseAmount(value: string): number | null | undefined {
  const t = value.replace(/[$,%\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** '' → null; otherwise a YYYY-MM-DD date, or undefined when unreadable. */
export function parseDate(value: string): string | null | undefined {
  const t = value.trim();
  if (!t) return null;
  return ISO_DATE.test(t) && !Number.isNaN(Date.parse(t)) ? t : undefined;
}

export function Field({ label, invalid, flex, children }: { label: string; invalid?: boolean; flex?: boolean; children: ReactNode }) {
  return (
    <View style={[styles.field, flex && styles.flex]}>
      <ThemedText type="small" themeColor={invalid ? 'negative' : 'textSecondary'}>
        {label}
        {invalid ? ' · check this' : ''}
      </ThemedText>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Input({ style, ...props }: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      style={[styles.input, props.multiline && styles.multiline, { color: theme.text, backgroundColor: theme.background }, style]}
      {...props}
    />
  );
}

export function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <View style={styles.chips}>
      <Chip label="Yes" selected={value === true} onPress={() => onChange(true)} />
      <Chip label="No" selected={value === false} onPress={() => onChange(false)} />
      <Chip label="Not sure" selected={value === null} onPress={() => onChange(null)} />
    </View>
  );
}

export const formStyles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  spacer: { flex: 1 },
});

const styles = StyleSheet.create({
  ...formStyles,
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  field: { gap: Spacing.one, minWidth: 140 },
  flex: { flex: 1 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
