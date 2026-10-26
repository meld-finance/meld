import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  size?: 'regular' | 'small';
};

export function Button({ label, variant = 'primary', loading, size = 'regular', disabled, style, ...rest }: Props) {
  const theme = useTheme();
  const background = variant === 'primary' ? theme.tint : theme.backgroundSelected;
  const color = variant === 'primary' ? '#ffffff' : variant === 'danger' ? theme.negative : theme.text;
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      style={(state) => [
        styles.base,
        size === 'small' && styles.small,
        { backgroundColor: background, opacity: inactive ? 0.5 : state.pressed ? 0.75 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <ThemedText type={size === 'small' ? 'smallBold' : 'default'} style={{ color }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  small: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two + Spacing.one, minHeight: 32 },
});
