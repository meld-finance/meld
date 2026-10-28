import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** Open the list upward, for a select near the bottom of the screen. */
  openUp?: boolean;
};

/** A compact select: the current choice, opening a list of options below it. */
export function Dropdown<T extends string>({ options, value, onChange, accessibilityLabel, openUp }: Props<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    // Raised so the open list draws over the content that follows.
    <View style={[styles.wrap, open && styles.raised]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ hovered }) => [
          styles.trigger,
          { backgroundColor: theme.backgroundElement, borderColor: hovered || open ? theme.tint : theme.border },
        ]}>
        <ThemedText type="small" numberOfLines={1} style={styles.label}>
          {current?.label}
        </ThemedText>
        <Icon name="chevronDown" size={16} themeColor="textSecondary" />
      </Pressable>
      {open && (
        <View style={[styles.menu, openUp ? styles.menuUp : styles.menuDown, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          {options.map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: o.value === value }}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              style={({ hovered }) => [
                styles.option,
                (hovered || o.value === value) && { backgroundColor: theme.backgroundSelected },
              ]}>
              <ThemedText type={o.value === value ? 'smallBold' : 'small'} numberOfLines={1}>
                {o.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  raised: { zIndex: 10 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
    minWidth: 160,
  },
  label: { flex: 1 },
  menu: {
    position: 'absolute',
    right: 0,
    minWidth: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  menuDown: { top: '100%', marginTop: Spacing.one },
  menuUp: { bottom: '100%', marginBottom: Spacing.one },
  option: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
