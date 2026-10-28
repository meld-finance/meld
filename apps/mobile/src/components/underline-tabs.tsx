import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

/** Page-level tabs: labels on a hairline, the selected one underlined in the tint. */
export function UnderlineTabs<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.row, { borderBottomColor: theme.border }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={({ hovered, pressed }) => [
              styles.tab,
              { borderBottomColor: selected ? theme.tint : 'transparent' },
              hovered && !selected && { borderBottomColor: theme.border },
              pressed && styles.pressed,
            ]}>
            <ThemedText type={selected ? 'smallBold' : 'small'} style={{ color: selected ? theme.tint : theme.textSecondary }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, columnGap: Spacing.two },
  tab: { paddingVertical: Spacing.two + Spacing.one, paddingHorizontal: Spacing.three, borderBottomWidth: 2, marginBottom: -1 },
  pressed: { opacity: 0.7 },
});
