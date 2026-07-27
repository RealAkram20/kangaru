import { useState, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import { Icon } from './Icon'

const SIZES = {
  sm: { height: 'var(--control-h-sm)', padding: '0 12px', fontSize: '13px', gap: 6, icon: 14 },
  md: { height: 'var(--control-h-md)', padding: '0 16px', fontSize: 'var(--text-sm)', gap: 8, icon: 16 },
  lg: { height: 'var(--control-h-lg)', padding: '0 24px', fontSize: 'var(--text-base)', gap: 8, icon: 18 },
} as const

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost'

function paint(variant: Variant, hover: boolean, onChrome: boolean): CSSProperties {
  if (variant === 'primary')
    return {
      background: hover ? 'var(--action-primary-hover)' : 'var(--action-primary)',
      color: 'var(--text-on-brand)',
      border: '1px solid transparent',
    }
  if (variant === 'secondary')
    return {
      background: hover ? 'var(--action-secondary-hover-bg)' : 'transparent',
      color: 'var(--action-secondary-text)',
      border: '1px solid var(--border-default)',
    }
  if (variant === 'destructive')
    return {
      background: hover ? 'var(--action-destructive-hover)' : 'var(--action-destructive)',
      color: 'var(--text-on-brand)',
      border: '1px solid transparent',
    }
  return {
    background: hover
      ? onChrome
        ? 'var(--action-ghost-hover-bg-chrome)'
        : 'var(--action-ghost-hover-bg)'
      : 'transparent',
    color: onChrome ? 'var(--text-on-chrome)' : 'var(--text-body)',
    border: '1px solid transparent',
  }
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** primary = the one committing action per view. destructive for irreversible finance/trip actions. */
  variant?: Variant
  /** sm 32px (table row actions) · md 40px (default) · lg 48px (marketing + booking CTAs) */
  size?: keyof typeof SIZES
  /** Lucide icon name rendered before the label. */
  iconLeft?: string
  /** Lucide icon name rendered after the label. */
  iconRight?: string
  loading?: boolean
  fullWidth?: boolean
  /** Set on navy chrome so ghost hover uses --surface-chrome-elevated. */
  onChrome?: boolean
  type?: 'button' | 'submit' | 'reset'
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  onChrome = false,
  type = 'button',
  onClick,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false)
  const s = SIZES[size] ?? SIZES.md
  const skin = paint(variant, hover && !disabled, onChrome)
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex',
        width: fullWidth ? '100%' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-semibold)',
        fontSize: s.fontSize,
        lineHeight: 1,
        borderRadius: 'var(--radius-control)',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'var(--transition-control)',
        whiteSpace: 'nowrap',
        ...skin,
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <Icon name="loader-circle" size={s.icon} />
      ) : iconLeft ? (
        <Icon name={iconLeft} size={s.icon} />
      ) : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={s.icon} /> : null}
    </button>
  )
}
