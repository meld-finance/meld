import { useRef, useState, type ComponentRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MAX_WIDTH = 360;
const EDGE = Spacing.three;
const GAP = Spacing.one;

type Rect = { x: number; y: number; width: number; height: number };

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** Open the list upward, for a select near the bottom of the screen. */
  openUp?: boolean;
};

/** A compact select: the current choice, opening a list of options in a window-level menu. */
export function Dropdown<T extends string>({ options, value, onChange, accessibilityLabel, openUp }: Props<T>) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const anchor = useRef<ComponentRef<typeof Pressable>>(null);
  const [at, setAt] = useState<Rect | null>(null);
  const open = !!at;
  const current = options.find((o) => o.value === value) ?? options[0];

  const close = () => setAt(null);
  const toggle = () => {
    if (at) {
      close();
      return;
    }
    anchor.current?.measureInWindow((x, y, width, height) => setAt({ x, y, width, height }));
  };

  const place = (() => {
    if (!at) return null;
    const maxAllowedW = Math.min(Math.max(at.width, MAX_WIDTH), window.width - EDGE * 2);
    const fitsRightFromLeft = at.x + maxAllowedW <= window.width - EDGE;
    const left = Math.max(EDGE, at.x);
    const right = Math.max(EDGE, window.width - (at.x + at.width));
    const horizontal = fitsRightFromLeft
      ? {
          left,
          minWidth: Math.min(at.width, window.width - left - EDGE),
          maxWidth: Math.min(maxAllowedW, window.width - left - EDGE),
        }
      : {
          right,
          minWidth: Math.min(at.width, window.width - right - EDGE),
          maxWidth: Math.min(maxAllowedW, window.width - right - EDGE),
        };
    const spaceBelow = window.height - (at.y + at.height + GAP) - EDGE;
    const spaceAbove = at.y - GAP - EDGE;
    const placeUp = openUp ? spaceAbove >= 120 || spaceAbove > spaceBelow : spaceBelow < 180 && spaceAbove > spaceBelow;
    return {
      ...horizontal,
      ...(placeUp ? { bottom: window.height - at.y + GAP } : { top: at.y + at.height + GAP }),
      maxHeight: Math.max(120, Math.min(320, placeUp ? spaceAbove : spaceBelow)),
    };
  })();

  return (
    <View style={styles.wrap}>
      <Pressable
        ref={anchor}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={({ hovered }) => [
          styles.trigger,
          { backgroundColor: theme.backgroundElement, borderColor: hovered || open ? theme.tint : theme.border },
        ]}>
        <ThemedText type="small" numberOfLines={1} style={styles.label}>
          {current?.label}
        </ThemedText>
        <Icon name="chevronDown" size={16} themeColor="textSecondary" />
      </Pressable>
      <Modal transparent visible={open} onRequestClose={close} animationType="none">
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu" />
        {place && (
          <View style={[styles.menu, place, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: o.value === value }}
                  onPress={() => {
                    onChange(o.value);
                    close();
                  }}
                  style={({ hovered }) => [
                    styles.option,
                    (hovered || o.value === value) && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText type={o.value === value ? 'smallBold' : 'small'}>
                    {o.label}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
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
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  option: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
