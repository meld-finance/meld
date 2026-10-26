/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    border: '#D9D9E0',
    tint: '#2F6FEB',
    positive: '#1E7F3C',
    negative: '#C5221F',
    warning: '#A15C00',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    border: '#363A3F',
    tint: '#6EA2FF',
    positive: '#5BB974',
    negative: '#F28B82',
    warning: '#FDD663',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Chart colors, from the validated data-viz reference palette (each mode is its
 * own selected step, not an automatic flip). Series slots are assigned in fixed
 * order; status colors are reserved for state and always paired with a label.
 */
export const VizColors = {
  light: {
    series1: '#2a78d6',
    series2: '#eb6834',
    seriesWash: 'rgba(42,120,214,0.10)',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    muted: '#898781',
    good: '#0ca30c',
    warning: '#fab219',
    critical: '#d03b3b',
    track: '#cde2fb',
  },
  dark: {
    series1: '#3987e5',
    series2: '#d95926',
    seriesWash: 'rgba(57,135,229,0.10)',
    grid: '#2c2c2a',
    axis: '#383835',
    muted: '#898781',
    good: '#0ca30c',
    warning: '#fab219',
    critical: '#d03b3b',
    track: '#184f95',
  },
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
