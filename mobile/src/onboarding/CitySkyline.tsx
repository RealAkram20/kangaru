import Svg, { Ellipse, Path, Rect } from 'react-native-svg';
import { StyleSheet } from 'react-native';

import { colors } from '../ui/theme';

/**
 * The faint city behind the hero, from the original design.
 *
 * Drawn rather than shipped as a PNG: the illustration is flat shapes in one
 * tint, which is exactly what SVG is for — it stays sharp on every screen,
 * costs a kilobyte instead of a few hundred, and recolours with the theme
 * instead of baking `#E6F4EC` into pixels.
 *
 * Two depth layers, the back one fainter, because that is what sells "city in
 * the haze" — a single opacity reads as a cardboard cutout. The hero's edge
 * feather then dissolves the whole thing into the page like everything else
 * in the carousel.
 */
const TINT = colors.primary;

/** Back row: taller silhouettes, barely there. */
const BACK: { x: number; w: number; h: number }[] = [
  { x: 40, w: 70, h: 210 },
  { x: 150, w: 55, h: 150 },
  { x: 300, w: 60, h: 175 },
  { x: 470, w: 65, h: 200 },
  { x: 600, w: 50, h: 140 },
  { x: 700, w: 60, h: 165 },
];

/** Front row: shorter, a shade firmer. */
const FRONT: { x: number; w: number; h: number }[] = [
  { x: 0, w: 55, h: 120 },
  { x: 105, w: 60, h: 95 },
  { x: 215, w: 50, h: 130 },
  { x: 385, w: 55, h: 110 },
  { x: 545, w: 55, h: 125 },
  { x: 660, w: 45, h: 90 },
  { x: 745, w: 55, h: 115 },
];

export function CitySkyline() {
  return (
    <Svg
      // Behind the carousel, pinned to the same bottom line the riders stand
      // on, so the city reads as background rather than as a frame.
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      viewBox="0 0 800 260"
      preserveAspectRatio="xMidYMax slice"
    >
      {BACK.map((b) => (
        <Rect
          key={`b${b.x}`}
          x={b.x}
          y={260 - b.h}
          width={b.w}
          height={b.h}
          fill={TINT}
          opacity={0.07}
        />
      ))}

      {/* The spire in the middle of the reference. */}
      <Rect x={396} y={95} width={8} height={165} fill={TINT} opacity={0.07} />
      <Rect x={388} y={120} width={24} height={140} fill={TINT} opacity={0.07} />
      <Rect x={378} y={150} width={44} height={110} fill={TINT} opacity={0.07} />

      {FRONT.map((b) => (
        <Rect
          key={`f${b.x}`}
          x={b.x}
          y={260 - b.h}
          width={b.w}
          height={b.h}
          fill={TINT}
          opacity={0.1}
        />
      ))}

      {/* Clouds, and the reference's one bird. */}
      <Ellipse cx={150} cy={48} rx={34} ry={13} fill={TINT} opacity={0.08} />
      <Ellipse cx={178} cy={40} rx={22} ry={10} fill={TINT} opacity={0.08} />
      <Ellipse cx={640} cy={34} rx={28} ry={11} fill={TINT} opacity={0.08} />
      <Path
        d="M556 70 q7 -8 14 0 q7 -8 14 0"
        stroke={TINT}
        strokeWidth={2.5}
        strokeLinecap="round"
        fill="none"
        opacity={0.18}
      />
    </Svg>
  );
}