import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

import { colors } from './theme';

/**
 * The icon set, drawn rather than installed.
 *
 * `@expo/vector-icons` would have been one line, and was not taken: it pulls
 * several full icon fonts into the bundle to render the handful of glyphs this
 * app actually uses, and a missing glyph in an icon font renders as a tofu box
 * rather than as nothing — the same failure the tab bar already works around
 * by refusing icons outright (see RootNavigator). Vectors cannot miss.
 *
 * ## The geometry is Lucide's, and that is a platform decision
 *
 * Every path below is transcribed from `lucide-react`, the set the web app
 * imports — see DESIGN.md § Icons, which makes Lucide the platform's single
 * icon vocabulary. The two apps therefore draw the *same shapes*, which is
 * the whole point: a driver's bell and a dispatcher's bell are one icon, and
 * a screenshot from either app belongs to the same product.
 *
 * **The web app can animate these and this one cannot.** Animate UI — the
 * animated Lucide set the frontend uses — is React DOM, Tailwind and Motion;
 * none of that exists under React Native. Redrawing by hand is not a
 * workaround chosen over the library, it is the only honest option here, and
 * matching Lucide's geometry is what keeps the difference invisible.
 *
 * **Transcribe, never approximate.** The paths are lifted verbatim from
 * `frontend/node_modules/lucide-react/dist/esm/icons/<name>.mjs`. Eyeballing
 * a shape is how the two apps drifted the first time, when this file was on
 * Feather's geometry and the web app was on Lucide's — close enough that
 * nobody noticed, different enough to be wrong.
 *
 * Lucide draws on a 24-unit grid with round caps and joins, which is why
 * `Outline` and `strokeProps` are shared by every glyph.
 */

type IconProps = {
  size?: number;
  color?: string;
  /**
   * Lucide draws at 2. This app defaults to 1.7 and that is deliberate: the
   * form fields want a finer line at their size, and DESIGN.md § Icons allows
   * the native app its own weight precisely because the *shape* is what has
   * to match, not the stroke. Pass 2 to sit at Lucide's own weight.
   */
  strokeWidth?: number;
};

const base = ({ size = 20, color = colors.placeholder, strokeWidth = 1.7 }: IconProps) => ({
  size,
  color,
  strokeWidth,
});

function Outline({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}

const strokeProps = (color: string, strokeWidth: number) => ({
  stroke: color,
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function UserIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" {...strokeProps(color, strokeWidth)} />
      <Circle cx="12" cy="7" r="4" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function PhoneIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

export function MailIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" {...strokeProps(color, strokeWidth)} />
      <Rect x="2" y="4" width="20" height="16" rx="2" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function LockIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" {...strokeProps(color, strokeWidth)} />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function EyeIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
        {...strokeProps(color, strokeWidth)}
      />
      <Circle cx="12" cy="12" r="3" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function EyeOffIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="m2 2 20 20" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function CheckIcon({ size = 16, color = colors.onPrimary, strokeWidth = 2.6 }: IconProps) {
  return (
    <Outline size={size}>
      <Path d="M20 6 9 17l-5-5" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="m15 18-6-6 6-6" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * The two brand marks are reproduced to their owners' guidelines — exact
 * colours, unmodified geometry. They are the one place in this file that is
 * not Lucide and not ours to adjust.
 */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

export function FacebookMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill="#1877F2" />
      <Path
        fill="#FFFFFF"
        d="M16.671 15.47l.532-3.47h-3.328v-2.25c0-.949.465-1.874 1.956-1.874h1.513V4.922s-1.374-.235-2.686-.235c-2.741 0-4.533 1.662-4.533 4.669V12H7.078v3.47h3.047v8.385a12.09 12.09 0 003.75 0V15.47h2.796z"
      />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M4 12h16" {...strokeProps(color, strokeWidth)} />
      <Path d="M4 6h16" {...strokeProps(color, strokeWidth)} />
      <Path d="M4 18h16" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function BellIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M10.268 21a2 2 0 0 0 3.464 0" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

export function ChevronRightIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="m9 18 6-6-6-6" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `chart-column`. Today's takings are a trend, not a balance. */
export function ChartIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M3 3v16a2 2 0 0 0 2 2h16" {...strokeProps(color, strokeWidth)} />
      <Path d="M18 17V9" {...strokeProps(color, strokeWidth)} />
      <Path d="M13 17V5" {...strokeProps(color, strokeWidth)} />
      <Path d="M8 17v-3" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `wallet`. */
export function WalletIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `circle-check-big`. */
export function CheckCircleIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M21.801 10A10 10 0 1 1 17 3.335" {...strokeProps(color, strokeWidth)} />
      <Path d="m9 11 3 3L22 4" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `copy`. The trip record's reference, for reading out to the office. */
export function CopyIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Rect x="8" y="8" width="14" height="14" rx="2" ry="2" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

/**
 * Lucide `circle-x` — the counterpart to `CheckCircleIcon` above.
 *
 * Drawn as a pair with it deliberately: the inbox distinguishes an approved
 * booking from a rejected one, and two glyphs that share a circle and differ
 * only in the mark inside it are read as one question with two answers. An
 * `AlertTriangleIcon` would have said "something is wrong" instead, which is
 * a different sentence.
 */
export function CircleXIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Circle cx="12" cy="12" r="10" {...strokeProps(color, strokeWidth)} />
      <Path d="m15 9-6 6" {...strokeProps(color, strokeWidth)} />
      <Path d="m9 9 6 6" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `star`, filled rather than stroked: a star reads as a rating only
 * when solid, and the fill colour is the theme's one warm token.
 */
export function StarIcon({ size = 20, color = colors.star }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
      />
    </Svg>
  );
}

/** Lucide `shield`. */
export function ShieldIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

/** Lucide `gauge`. Duty: the driver is running or they are not. */
export function GaugeIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="m12 14 4-4" {...strokeProps(color, strokeWidth)} />
      <Path d="M3.34 19a10 10 0 1 1 17.32 0" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `briefcase`. Trips done — this counts work, not correctness. */
export function BagIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" {...strokeProps(color, strokeWidth)} />
      <Rect width="20" height="14" x="2" y="6" rx="2" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `shield-check`. A standing kept, for the rate tiles. */
export function ShieldCheckIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="m9 12 2 2 4-4" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `navigation`. How far the driver is from the pickup.
 *
 * A heading arrow rather than a pin, because the figure beside it is a
 * *distance from here* — the pin is the place, this is the leg to it.
 */
/**
 * Lucide `camera`. A dashboard photo was captured with an odometer reading.
 *
 * Added to replace a 📷 that was standing in for it. DESIGN.md § Icons bans
 * emoji as interface iconography outright, and the reason is not taste: an
 * emoji is drawn by the *platform's* font, so it is a different picture on
 * every handset in the fleet, it ignores the theme colour it is given, and it
 * does not scale with the type around it. A vector does all three.
 */
export function CameraIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"
        {...strokeProps(color, strokeWidth)}
      />
      <Circle cx="12" cy="13" r="3" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

export function NavigationIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Polygon points="3 11 22 2 13 21 11 13 3 11" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `pause` and `play`. Holding a trip, and picking it up again.
 *
 * The transport-control pair, filled for the same reason `SquareIcon` is: they
 * sit inside buttons, and an outlined pause on a filled ground reads as two
 * empty boxes. Filled shapes at this size also survive the sunlight these are
 * read in, where a 1.7pt stroke does not.
 *
 * They are a **pair on purpose**. Pausing and resuming are one control in two
 * states, and a driver who has learned that the two bars mean "hold" reads the
 * triangle as "carry on" without being told — which is worth more here than on
 * most screens, because the button beside them ends a billable journey.
 */
export function PauseIcon({ size = 16, color = colors.textBody }: IconProps) {
  return (
    <Outline size={size}>
      <Rect x="14" y="3" width="5" height="18" rx="1" fill={color} />
      <Rect x="5" y="3" width="5" height="18" rx="1" fill={color} />
    </Outline>
  );
}

export function PlayIcon({ size = 16, color = colors.onPrimary }: IconProps) {
  return (
    <Outline size={size}>
      <Path
        d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"
        fill={color}
      />
    </Outline>
  );
}

/**
 * Lucide `square`. Stop — the End trip button.
 *
 * The transport-control stop glyph, which is what the mockup drew and what
 * every media control on the handset already uses for "end this". A red
 * button carries the weight; the square says *what kind* of action it is, and
 * `docs/screen-rules.md` forbids meaning by colour alone — the label says
 * "End trip" and the glyph agrees with it.
 *
 * Filled rather than outlined, unlike every other icon in this file. An
 * outlined square on a filled button reads as an empty checkbox, which on the
 * one control that ends a billable journey is the wrong thing to suggest.
 */
export function SquareIcon({ size = 16, color = colors.onPrimary }: IconProps) {
  return (
    <Outline size={size}>
      <Rect x="3" y="3" width="18" height="18" rx="2" fill={color} />
    </Outline>
  );
}

/**
 * Lucide `map-pin`. A place, as against the leg to it.
 *
 * Paired with `NavigationIcon` and deliberately not interchangeable with it:
 * the pin marks *where the pickup is*, the arrow is *travelling there*. The
 * waiting screen shows both in one row — the pin labelling the address, the
 * arrow on the button that hands it to a maps app — and using one glyph for
 * both would make the button look like a repeat of the label rather than an
 * action on it.
 */
export function MapPinIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
        {...strokeProps(color, strokeWidth)}
      />
      <Circle cx="12" cy="10" r="3" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `route`. The job itself, pickup to drop-off. */
export function RouteIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Circle cx="6" cy="19" r="3" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"
        {...strokeProps(color, strokeWidth)}
      />
      <Circle cx="18" cy="5" r="3" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `package`. What is being sent, on a delivery. */
export function PackageIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M12 22V12" {...strokeProps(color, strokeWidth)} />
      <Polyline points="3.29 7 12 12 20.71 7" {...strokeProps(color, strokeWidth)} />
      <Path d="m7.5 4.27 9 5.15" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `car`. A ride, as against a parcel. */
export function CarIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"
        {...strokeProps(color, strokeWidth)}
      />
      <Circle cx="7" cy="17" r="2" {...strokeProps(color, strokeWidth)} />
      <Path d="M9 17h6" {...strokeProps(color, strokeWidth)} />
      <Circle cx="17" cy="17" r="2" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `house`. The Home tab.
 *
 * Transcribed verbatim, arc commands and all — the roof is one path with two
 * `a 2 2` corners and the doorway is a second. Redrawing it as a triangle on a
 * square, which is the obvious hand approximation, is exactly the drift
 * DESIGN.md § Icons was written to stop.
 */
export function HouseIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
        {...strokeProps(color, strokeWidth)}
      />
      <Path
        d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

/**
 * Lucide `receipt`. Earnings — the tab, and the Home screen's tile.
 *
 * The mockup draws a receipt for earnings, and `ChartIcon` was already doing
 * that job on the Home tile. Rather than run two glyphs for one idea — which
 * DESIGN.md § Icons calls out by name — both now use this one.
 *
 * The long third path is the torn bottom edge and is copied character for
 * character: it is a run of eleven alternating `1.3` arcs, and eyeballing it
 * produces a shape that is recognisably not Lucide's.
 */
export function ReceiptIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M12 17V7" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"
        {...strokeProps(color, strokeWidth)}
      />
      <Path
        d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

/**
 * Lucide `hand-coins`. A tip (ADR-0034).
 *
 * Not `star`, which the mockup drew for it — a star means a **rating** in
 * this product (`StarIcon`, ADR-0030), and reusing it for money would invert
 * the glyph's meaning platform-wide on the one screen where the two could be
 * confused. A hand passing coins is what actually happens.
 */
export function HandCoinsIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"
        {...strokeProps(color, strokeWidth)}
      />
      <Path
        d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="m2 16 6 6" {...strokeProps(color, strokeWidth)} />
      <Circle cx="16" cy="9" r="2.9" {...strokeProps(color, strokeWidth)} />
      <Circle cx="6" cy="5" r="3" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `award`. A weekly target bonus (ADR-0034 §4).
 *
 * The mockup drew a star here too, in amber. Same objection as above, and the
 * colour is not taken either: `colors.star` is declared for a rating and is
 * the only warm value in the palette. A bonus is money and reads in the same
 * green every other credit does.
 */
export function AwardIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"
        {...strokeProps(color, strokeWidth)}
      />
      <Circle cx="12" cy="8" r="6" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `trending-up`. The peak-hours card (ADR-0036).
 *
 * The mockup drew a figure on a podium here. An illustration is not an icon
 * and this app has no illustration set — DESIGN.md § Icons makes Lucide the
 * one vocabulary, and a stock character would also be the only depiction of a
 * person anywhere in the app, which is a bigger decision than a card.
 *
 * A rising line is the honest glyph for *earning more*, and it is not
 * `AwardIcon`: that one already means a bonus on the wallet statement, and one
 * glyph for two schemes would make the two cards read as the same offer.
 */
export function TrendingUpIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M16 7h6v6" {...strokeProps(color, strokeWidth)} />
      <Path d="m22 7-8.5 8.5-5-5L2 17" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `user-plus`. The referral card (ADR-0037).
 *
 * A person being added, which is literally what a referral is. Lucide's
 * `gift` was the other candidate and is wrong: the reward is money credited to
 * the *referrer*, not a present given to the person joining, and a gift box
 * beside a cash figure suggests something the platform does not do.
 */
export function UserPlusIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...strokeProps(color, strokeWidth)} />
      <Circle cx="9" cy="7" r="4" {...strokeProps(color, strokeWidth)} />
      <Line x1="19" x2="19" y1="8" y2="14" {...strokeProps(color, strokeWidth)} />
      <Line x1="22" x2="16" y1="11" y2="11" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `share-2`. Passing a referral code to somebody.
 *
 * The action is the platform's own share sheet rather than a clipboard copy —
 * no new dependency (`expo-clipboard` is not installed and a referral card is
 * not a reason to add one), and a driver sending a code through WhatsApp is
 * what actually happens, where "Copied!" leaves them to find the app
 * themselves.
 */
export function ShareIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Circle cx="18" cy="5" r="3" {...strokeProps(color, strokeWidth)} />
      <Circle cx="6" cy="12" r="3" {...strokeProps(color, strokeWidth)} />
      <Circle cx="18" cy="19" r="3" {...strokeProps(color, strokeWidth)} />
      <Line x1="8.59" x2="15.42" y1="13.51" y2="17.49" {...strokeProps(color, strokeWidth)} />
      <Line x1="15.41" x2="8.59" y1="6.51" y2="10.49" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `gift`. Promotions, in the drawer.
 *
 * The mockup draws this and it is right *here*, where `AwardIcon` is not: in a
 * thirteen-row menu `award` sits two rows from `gauge` (Performance) and the
 * two read as the same idea at a glance. On the Promotions screen itself and
 * on the wallet statement, `award` still means a bonus — the vocabulary is per
 * concept, and "the promotions section" and "a bonus credit" are two.
 */
export function GiftIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M12 7v14" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"
        {...strokeProps(color, strokeWidth)}
      />
      <Rect x="3" y="7" width="18" height="4" rx="1" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `headset`. Support — reaching a person at the office. */
export function HeadsetIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M21 16v2a4 4 0 0 1-4 4h-5" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `power`. Going off duty, from the drawer. */
export function PowerIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M12 2v10" {...strokeProps(color, strokeWidth)} />
      <Path d="M18.4 6.6a9 9 0 1 1-12.77.04" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `settings`. */
export function SettingsIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        {...strokeProps(color, strokeWidth)}
      />
      <Circle cx="12" cy="12" r="3" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `square-arrow-up`. The wallet's Withdraw button. */
export function SquareArrowUpIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Rect width="18" height="18" x="3" y="3" rx="2" {...strokeProps(color, strokeWidth)} />
      <Path d="m16 12-4-4-4 4" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 16V8" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `circle-plus`. The wallet's Add Money button. */
export function CirclePlusIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Circle cx="12" cy="12" r="10" {...strokeProps(color, strokeWidth)} />
      <Path d="M8 12h8" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 8v8" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `banknote`. Settlement in cash. */
export function BanknoteIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Rect width="20" height="12" x="2" y="6" rx="2" {...strokeProps(color, strokeWidth)} />
      <Circle cx="12" cy="12" r="2" {...strokeProps(color, strokeWidth)} />
      <Path d="M6 12h.01M18 12h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `smartphone`. Settlement by mobile money. */
export function SmartphoneIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Rect width="14" height="20" x="5" y="2" rx="2" ry="2" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 18h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/** Lucide `credit-card`. Settlement by card. */
export function CreditCardIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Rect width="20" height="14" x="2" y="5" rx="2" {...strokeProps(color, strokeWidth)} />
      <Line x1="2" x2="22" y1="10" y2="10" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `x`. Declining a job.
 *
 * Paired with a word, never standing alone: DESIGN.md § Icons is explicit
 * that a glyph carries meaning only alongside a label.
 */
export function XIcon({ size = 16, color = colors.danger, strokeWidth = 2.4 }: IconProps) {
  return (
    <Outline size={size}>
      <Path d="M18 6 6 18" {...strokeProps(color, strokeWidth)} />
      <Path d="m6 6 12 12" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `file-text`. A driver's papers.
 *
 * Transcribed verbatim from
 * `lucide-react/dist/esm/icons/file-text.mjs` (ADR-0033's Documents row).
 */
export function FileTextIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M14 2v5a1 1 0 0 0 1 1h5" {...strokeProps(color, strokeWidth)} />
      <Path d="M10 9H8" {...strokeProps(color, strokeWidth)} />
      <Path d="M16 13H8" {...strokeProps(color, strokeWidth)} />
      <Path d="M16 17H8" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `log-out`. Signing out.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/log-out.mjs`. The
 * arrow points out of the door, which is the direction the action goes — the
 * mirrored `log-in` is a different glyph and means the opposite.
 */
export function LogOutIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="m16 17 5-5-5-5" {...strokeProps(color, strokeWidth)} />
      <Path d="M21 12H9" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

/**
 * Lucide `trash-2`. Deleting the account.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/trash-2.mjs`.
 *
 * `trash-2` rather than `trash`: the lidded bin with two lines reads as a bin
 * at 22 points where the plain one reads as a cup. It is the glyph the web
 * console already uses for a destructive row, and one vocabulary across both
 * apps is DESIGN.md §7's whole point.
 */
export function Trash2Icon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M10 11v6" {...strokeProps(color, strokeWidth)} />
      <Path d="M14 11v6" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M3 6h18" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

/**
 * Lucide `triangle-alert`. The danger zone's heading.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/triangle-alert.mjs`.
 *
 * It carries the warning **beside a written one**, never instead of it:
 * `docs/screen-rules.md` §6 forbids meaning carried by colour alone, and a red
 * triangle with no sentence is exactly that failure in glyph form.
 */
export function TriangleAlertIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M12 9v4" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 17h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `pencil`. Editing a fact the driver owns.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/pencil.mjs`.
 *
 * Marks the rows a driver may change, so the office-managed ones are legible
 * as deliberate rather than missing — the difference this screen is being
 * rebuilt to make.
 */
export function PencilIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="m15 5 4 4" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `calendar`. Time off.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/calendar.mjs`.
 */
export function CalendarIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M8 2v4" {...strokeProps(color, strokeWidth)} />
      <Path d="M16 2v4" {...strokeProps(color, strokeWidth)} />
      <Rect width="18" height="18" x="3" y="4" rx="2" {...strokeProps(color, strokeWidth)} />
      <Path d="M3 10h18" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `upload`. Sending a document to the office.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/upload.mjs`.
 */
export function UploadIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path d="M12 3v12" {...strokeProps(color, strokeWidth)} />
      <Path d="m17 8-5-5-5 5" {...strokeProps(color, strokeWidth)} />
      <Path
        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        {...strokeProps(color, strokeWidth)}
      />
    </Outline>
  );
}

/**
 * Lucide `triangle-alert`. Something needs the driver's attention.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/triangle-alert.mjs`.
 *
 * Used where a *state* is wrong rather than where an action failed: a rejected
 * document, a parked outbox item. It is deliberately not `circle-alert`, which
 * this app does not carry — one glyph per idea, per DESIGN.md § Icons.
 */
export function AlertTriangleIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M12 9v4" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 17h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `clock`. Waiting on somebody else.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/clock.mjs`.
 */
export function ClockIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Circle cx="12" cy="12" r="10" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 6v6l4 2" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `shield-alert`. Something went wrong and it is being reported.
 *
 * Transcribed verbatim from `lucide-react/dist/esm/icons/shield-alert.mjs`.
 *
 * **Not `ShieldIcon` and not `ShieldCheckIcon`.** The plain shield is the
 * safety-net glyph this app uses for "the office can see you"; the check is a
 * verified document. This is the one with the exclamation in it, and on the
 * Help & Safety screen all three would otherwise be the same shape saying
 * three different things.
 */
export function ShieldAlertIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M12 8v4" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 16h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `message-circle-warning`. A problem with a person.
 *
 * Transcribed verbatim from
 * `lucide-react/dist/esm/icons/message-circle-warning.mjs`.
 *
 * A speech bubble here is **not** a promise of messaging — this app has none,
 * deliberately (`trips/contact.ts`). It is the passenger-shaped glyph on a
 * list of things to tell the office about, and the row it labels opens the
 * dialler like every other route out of this screen.
 */
export function MessageCircleWarningIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M12 8v4" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 16h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `message-circle-more`. Talking to the office.
 *
 * Transcribed verbatim from
 * `lucide-react/dist/esm/icons/message-circle-more.mjs`.
 *
 * The mockup's Contact Support glyph. `HeadsetIcon` is the other candidate and
 * is already used for "call the office" on this same screen — two identical
 * headsets one card apart would read as the same control twice.
 */
export function MessageCircleMoreIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Path
        d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"
        {...strokeProps(color, strokeWidth)}
      />
      <Path d="M8 12h.01" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 12h.01" {...strokeProps(color, strokeWidth)} />
      <Path d="M16 12h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}

/**
 * Lucide `circle-question-mark`. Something whose whereabouts are unknown.
 *
 * Transcribed verbatim from
 * `lucide-react/dist/esm/icons/circle-question-mark.mjs`. Lucide still exports
 * it under the older alias `circle-help`, which re-exports this file — the name
 * here follows the file that holds the geometry.
 */
export function CircleQuestionMarkIcon(props: IconProps) {
  const { size, color, strokeWidth } = base(props);

  return (
    <Outline size={size}>
      <Circle cx="12" cy="12" r="10" {...strokeProps(color, strokeWidth)} />
      <Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" {...strokeProps(color, strokeWidth)} />
      <Path d="M12 17h.01" {...strokeProps(color, strokeWidth)} />
    </Outline>
  );
}
