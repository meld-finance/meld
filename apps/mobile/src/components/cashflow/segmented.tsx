import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'small' | 'default';
};

/** A pill of mutually exclusive options; the selected one fills with the tint. */
export function Segmented<T extends string>({ options, value, onChange, size = 'default' }: Props<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.wrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={({ hovered, pressed }) => [
              styles.option,
              size === 'small' && styles.optionSmall,
              selected && { backgroundColor: theme.tint },
              !selected && hovered && { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText type={selected ? 'smallBold' : 'small'} style={{ color: selected ? '#ffffff' : theme.textSecondary }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderWidth: 1, borderRadius: Spacing.five, padding: Spacing.one, gap: Spacing.one },
  option: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.five },
  optionSmall: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.7 },
});
