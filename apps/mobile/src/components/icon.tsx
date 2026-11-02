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
  flag: <Path d="M5 21V4M5 4c5-3 9 3 14 0v10c-5 3-9-3-14 0" />,
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
  barChart: <Path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  calendar: (
    <>
      <Rect x={3} y={5} width={18} height={16} rx={2} />
      <Path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  message: <Path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-4.6A8 8 0 1 1 21 12Z" />,
  arrowUpRight: <Path d="M7 17 17 7M8 7h9v9" />,
  arrowDownRight: <Path d="M7 7l10 10M17 8v9H8" />,
  arrowRight: <Path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUp: <Path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <Path d="M12 5v14M6 13l6 6 6-6" />,
  more: (
    <>
      <Circle cx={5} cy={12} r={1} />
      <Circle cx={12} cy={12} r={1} />
      <Circle cx={19} cy={12} r={1} />
    </>
  ),
  link: (
    <>
      <Path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <Path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  chevronDown: <Path d="m6 9 6 6 6-6" />,
  chevronLeft: <Path d="m15 6-6 6 6 6" />,
  chevronRight: <Path d="m9 6 6 6-6 6" />,
  chevronUp: <Path d="m6 15 6-6 6 6" />,
  close: <Path d="M18 6 6 18M6 6l12 12" />,
  expand: <Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  collapse: <Path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
  sun: (
    <>
      <Circle cx={12} cy={12} r={4} />
      <Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <Path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  monitor: (
    <>
      <Rect x={3} y={4} width={18} height={12} rx={2} />
      <Path d="M8 20h8M12 16v4" />
    </>
  ),
  search: (
    <>
      <Circle cx={11} cy={11} r={7} />
      <Path d="m20 20-3.5-3.5" />
    </>
  ),
  check: <Path d="m5 12.5 4.5 4.5L19 7.5" />,
  info: (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 11v5M12 8h.01" />
    </>
  ),
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
