/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F1B3D',
    background: '#F6F8FB',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#EAF0FA',
    textSecondary: '#5B6478',
    border: '#E3E8F0',
    tint: '#2563EB',
    positive: '#1E8A4C',
    negative: '#C5221F',
    warning: '#A15C00',
  },
  dark: {
    text: '#EEF2F8',
    background: '#0B1020',
    backgroundElement: '#141A2B',
    backgroundSelected: '#1F2840',
    textSecondary: '#9BA4B8',
    border: '#252E45',
    tint: '#6EA2FF',
    positive: '#5BB974',
    negative: '#F28B82',
    warning: '#FDD663',
  },
} as const;

/**
 * Soft tinted backgrounds + icon colors for category tiles and icon badges.
 * Decorative only: every tile also carries a text label.
 */
export const AccentColors = {
  light: {
    blue: { bg: '#EEF3FE', fg: '#2563EB' },
    green: { bg: '#EAF6EF', fg: '#1E8A4C' },
    purple: { bg: '#F2EFFD', fg: '#6D4AE0' },
    orange: { bg: '#FEF3E8', fg: '#E8742A' },
    teal: { bg: '#E9F5F4', fg: '#13897E' },
  },
  dark: {
    blue: { bg: '#17233F', fg: '#7FA8FF' },
    green: { bg: '#132B22', fg: '#5BC48A' },
    purple: { bg: '#221C3E', fg: '#A894FF' },
    orange: { bg: '#33231A', fg: '#F5A061' },
    teal: { bg: '#112B2B', fg: '#4CC5B8' },
  },
} as const;

export type Accent = keyof typeof AccentColors.light;

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
    /** Net worth trend: a single series, green per the brand. */
    trend: '#2a9461',
    trendWash: 'rgba(42,148,97,0.10)',
    grid: '#e8ecf2',
    axis: '#cbd2dd',
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
    trend: '#36ab74',
    trendWash: 'rgba(54,171,116,0.14)',
    grid: '#222a3d',
    axis: '#323b52',
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
/** The home dashboard spreads wider than list/detail screens. */
export const WideContentWidth = 1360;
