import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'small' | 'default';
  /** Allow horizontal scrolling when many tabs exceed narrow mobile viewports. */
  scrollable?: boolean;
};

/** A pill of mutually exclusive options; the selected one fills with the tint. */
export function Segmented<T extends string>({ options, value, onChange, size = 'default', scrollable = false }: Props<T>) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollViewInstance>(null);

  const pills = (
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
            onLayout={
              scrollable && selected
                ? (e) => scrollRef.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - Spacing.four), animated: false })
                : undefined
            }
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

  if (!scrollable) return pills;
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}>
      {pills}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxWidth: '100%' },
  scrollContent: { flexGrow: 0 },
  wrap: { flexDirection: 'row', borderWidth: 1, borderRadius: Spacing.five, padding: Spacing.one, gap: Spacing.one },
  option: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.five },
  optionSmall: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.7 },
});
