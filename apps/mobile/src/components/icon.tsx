import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/constants/theme';

/** Outline icons drawn on a 24×24 grid (shapes adapted from Lucide, ISC license). */
const ICONS = {
  home: (
    <>
      <Path d="M3 10.5 12 3l9 7.5" />
      <Path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" />
    </>
  ),
  wallet: (
    <>
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path d="M3 10h18" />
      <Path d="M7 15h3" />
    </>
  ),
  bank: (
    <>
      <Path d="M3 21h18" />
      <Path d="M3 9h18L12 3 3 9Z" />
      <Path d="M6 9v9M10 9v9M14 9v9M18 9v9" />
    </>
  ),
  card: (
    <>
      <Rect x={2.5} y={5} width={19} height={14} rx={2.5} />
      <Path d="M2.5 10h19" />
      <Path d="M6.5 15h4" />
    </>
  ),
  chart: (
    <>
      <Path d="M3 3v18h18" />
      <Path d="m7 14 4-4 3 3 6-6" />
    </>
  ),
  receipt: (
    <>
      <Path d="M5 3v18l2.5-1.5L10 21l2-1.5 2 1.5 2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5 5 3Z" />
      <Path d="M9 9h6M9 13h6" />
    </>
  ),
  pie: (
    <>
      <Path d="M21 12a9 9 0 1 1-9-9" />
      <Path d="M21 12A9 9 0 0 0 12 3v9h9Z" />
    </>
  ),
  shield: <Path d="M12 21.5s8-3.5 8-10V5l-8-3-8 3v6.5c0 6.5 8 10 8 10Z" />,
  sparkles: (
    <>
      <Path d="M10 3.5 11.8 8.2 16.5 10 11.8 11.8 10 16.5 8.2 11.8 3.5 10 8.2 8.2 10 3.5Z" />
      <Path d="M18 14.5v5M15.5 17h5" />
      <Path d="M18 2.5v3M16.5 4h3" />
    </>
  ),
  user: (
    <>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </>
  ),
  lock: (
    <>
      <Rect x={4} y={10.5} width={16} height={10.5} rx={2} />
      <Path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  arrowUpRight: <Path d="M7 17 17 7M8 7h9v9" />,
  arrowRight: <Path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUp: <Path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <Path d="M12 5v14M6 13l6 6 6-6" />,
  chevronDown: <Path d="m6 9 6 6 6-6" />,
} as const;

export type IconName = keyof typeof ICONS;

type Props = {
  name: IconName;
  size?: number;
  /** A raw color, e.g. an accent; defaults to the theme's text color. */
  color?: string;
  themeColor?: ThemeColor;
  strokeWidth?: number;
};

export function Icon({ name, size = 20, color, themeColor, strokeWidth = 1.75 }: Props) {
  const theme = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme[themeColor ?? 'text']}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round">
      {ICONS[name]}
    </Svg>
  );
}
