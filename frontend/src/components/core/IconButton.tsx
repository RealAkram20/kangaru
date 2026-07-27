import { useState, type ButtonHTMLAttributes } from 'react'
import { Icon } from './Icon'

const SIZES = { sm: 32, md: 40, lg: 48 } as const
const GLYPH = { sm: 16, md: 18, lg: 20 } as const

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Lucide icon name. */
  icon: string
  /** Required — becomes aria-label and the tooltip. Icon-only controls are never unlabelled. */
  label: string
  size?: keyof typeof SIZES
  variant?: 'ghost' | 'outline' | 'primary'
  /** Set on navy chrome (sidebar, topbar). */
  onChrome?: boolean
}

/**
 * Ported as a transitive dependency of Topbar/SidebarNav — not in the
 * original minimum component list, but required for either to render.
 */
export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  onChrome = false,
  disabled = false,
  onClick,
  style,
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = useState(false)
  const box = SIZES[size] ?? SIZES.md
  const filled = variant === 'primary'
  const bg = filled
    ? hover && !disabled
      ? 'var(--action-primary-hover)'
      : 'var(--action-primary)'
    : hover && !disabled
      ? onChrome
        ? 'var(--action-ghost-hover-bg-chrome)'
        : 'var(--action-ghost-hover-bg)'
      : 'transparent'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: box,
        height: box,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        color: filled ? 'var(--text-on-brand)' : onChrome ? 'var(--text-on-chrome)' : 'var(--text-secondary)',
        border: variant === 'outline' ? '1px solid var(--border-default)' : '1px solid transparent',
        borderRadius: 'var(--radius-control)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'var(--transition-control)',
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={GLYPH[size] ?? 18} />
    </button>
  )
}
