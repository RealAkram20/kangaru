import type { CSSProperties, HTMLAttributes } from 'react'
import { icons } from 'lucide-react'

/**
 * Ported from `KangaruRide Design System/components/core/Icon.jsx`. The
 * original reads `window.lucide.icons` (CDN UMD global) since the design
 * system's browser preview harness has no bundler; here we use the
 * `lucide-react` npm package's synchronous `icons` dictionary instead —
 * the only real change needed to make this component work in a real,
 * offline-capable Vite build.
 */
function toPascal(name: string): string {
  return name.replace(/(^|[-_])(\w)/g, (_match, _sep, char: string) => char.toUpperCase())
}

export interface IconProps extends HTMLAttributes<HTMLSpanElement | SVGSVGElement> {
  /** Lucide icon name, kebab or Pascal case: "truck", "map-pin", "MapPin". */
  name: string
  /** Pixel box. 16 in dense tables, 20 default, 24 for nav. */
  size?: number
  /** Lucide default is 2; use 1.5 only at 24px+. */
  strokeWidth?: number
  /** Defaults to currentColor — colour comes from the parent. */
  color?: string
  /** Provide only when the icon is the sole label; otherwise leave undefined (decorative). */
  title?: string
  style?: CSSProperties
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  color = 'currentColor',
  title,
  style,
  ...rest
}: IconProps) {
  const LucideIcon = icons[toPascal(name) as keyof typeof icons]
  const box: CSSProperties = {
    width: size,
    height: size,
    display: 'inline-block',
    flex: '0 0 auto',
    verticalAlign: 'middle',
  }

  if (!LucideIcon) {
    return (
      <span
        aria-hidden="true"
        style={{ ...box, borderRadius: 2, background: 'currentColor', opacity: 0.18, ...style }}
        {...rest}
      />
    )
  }

  return (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
      style={{ ...box, ...style }}
      {...rest}
    />
  )
}
