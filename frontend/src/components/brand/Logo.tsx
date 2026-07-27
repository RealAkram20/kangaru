import type { CSSProperties, ImgHTMLAttributes } from 'react'

const FILES = {
  horizontal: 'logo-horizontal.png',
  'horizontal-navy': 'logo-horizontal-navy.png',
  stacked: 'logo-stacked-light.png',
  mono: 'logo-horizontal-mono.png',
  mark: 'logo-mark.png',
  'mark-solid': 'logo-mark-solid.png',
} as const

type Variant = keyof typeof FILES

export interface LogoProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'height'> {
  /**
   * horizontal      — navy/green lockup for light surfaces (default)
   * horizontal-navy — white/green lockup, for navy chrome and dark heroes
   * stacked         — mark above wordmark, for login and print
   * mono            — single-colour black lockup, for documents and faxable PDFs
   * mark            — outlined circle mark only
   * mark-solid      — solid green circle mark only, for app icons and avatars
   */
  variant?: Variant
  /** Rendered height in px. Minimum 24px for lockups, 20px for the mark. */
  height?: number
  /** Path from the consuming page to the copied assets folder (served from `public/assets`). */
  basePath?: string
  /** With a mark variant, sets the wordmark in Sora beside it (used when the sidebar is expanded). */
  withWordmark?: boolean
  style?: CSSProperties
}

export function Logo({
  variant = 'horizontal',
  height = 32,
  basePath = '/assets',
  withWordmark = false,
  style,
  ...rest
}: LogoProps) {
  const src = `${basePath}/${FILES[variant] ?? FILES.horizontal}`
  const isMark = variant.startsWith('mark')
  const img = (
    <img
      src={src}
      alt="KangaruRide"
      style={{
        height,
        width: isMark ? height : 'auto',
        display: 'block',
        objectFit: 'contain',
        ...(withWordmark ? {} : style),
      }}
      {...(withWordmark ? {} : rest)}
    />
  )
  if (!withWordmark || !isMark) return img
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', ...style }} {...rest}>
      {img}
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--weight-bold)',
          fontSize: Math.round(height * 0.55),
          letterSpacing: 'var(--tracking-tight)',
          color: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        KangaruRide
      </span>
    </span>
  )
}
