import { useId } from 'react';
import Svg, { Circle, ClipPath, Defs, FeGaussianBlur, Filter, G, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Three overlapping tiles that glow where all three meet. Keep in step with site/logo.svg (cropped to the tiles here). */
const TILES = [
  { at: 'translate(50 42) rotate(45)', from: '#4033B0', to: '#6A5BE2', opacity: 0.92 },
  { at: 'translate(38 58) rotate(45)', from: '#2A66E3', to: '#4C8FF3', opacity: 0.82 },
  { at: 'translate(62 58) rotate(45)', from: '#36AE9E', to: '#6CCFBA', opacity: 0.8 },
];

export function Logo({ size = 32 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const tile = (at: string, props: object = {}, key?: number) => <Rect key={key} x={-23} y={-23} width={46} height={46} rx={14} transform={at} {...props} />;
  return (
    <Svg width={size} height={size} viewBox="8 8 84 84">
      <Defs>
        {TILES.map((t, i) => (
          <LinearGradient key={i} id={`${id}t${i}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.from} />
            <Stop offset="1" stopColor={t.to} />
          </LinearGradient>
        ))}
        <RadialGradient id={`${id}glow`} cx="50" cy="52" r="14" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.55" stopColor="#F6FCFF" />
          <Stop offset="1" stopColor="#C4E6FF" />
        </RadialGradient>
        <ClipPath id={`${id}c0`}>{tile(TILES[0]!.at)}</ClipPath>
        <ClipPath id={`${id}c1`}>{tile(TILES[1]!.at)}</ClipPath>
        <Filter id={`${id}halo`} x="-50%" y="-50%" width="200%" height="200%">
          <FeGaussianBlur stdDeviation={5} />
        </Filter>
        <Filter id={`${id}soft`} x="-50%" y="-50%" width="200%" height="200%">
          <FeGaussianBlur stdDeviation={1.6} />
        </Filter>
      </Defs>
      {TILES.map((t, i) => tile(t.at, { fill: `url(#${id}t${i})`, fillOpacity: t.opacity }, i))}
      <Circle cx={50} cy={52} r={11} fill="#EAF6FF" opacity={0.75} filter={`url(#${id}halo)`} />
      {[0, 1].map((k) => (
        <G key={k} filter={`url(#${id}soft)`}>
          <G clipPath={`url(#${id}c0)`}>
            <G clipPath={`url(#${id}c1)`}>{tile(TILES[2]!.at, { fill: `url(#${id}glow)` })}</G>
          </G>
        </G>
      ))}
    </Svg>
  );
}
