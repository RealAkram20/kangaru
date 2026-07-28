import type { HTMLAttributes } from 'react'
import { Icon } from '../core/Icon'

export interface KPIStatProps extends HTMLAttributes<HTMLDivElement> {
  /** Inter Medium 14px, sentence case. */
  label: string
  /** The number itself — Sora Bold 30px, tabular. Pre-format it (thousands separators, UGX). */
  value: string | number
  /** Trailing unit, e.g. "km", "trips", "%". */
  unit?: string
  /** Signed change string, e.g. "+12%". */
  delta?: string
  /** Direction decides colour: up = success green, down = error red. */
  deltaDirection?: 'up' | 'down'
  /** Lucide icon in the top-right. */
  icon?: string
  tone?: 'default' | 'accent'
  /** Comparison period or scope, e.g. "vs last week". */
  hint?: string
}

export function KPIStat({
  label,
  value,
  unit,
  delta,
  deltaDirection = 'up',
  icon,
  tone = 'default',
  hint,
  style,
  ...rest
}: KPIStatProps) {
  const good = deltaDirection === 'up'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--pad-card-compact)',
        background: tone === 'accent' ? 'var(--surface-accent)' : 'var(--surface-card)',
        border: '1px solid ' + (tone === 'accent' ? 'var(--kr-green-tint)' : 'var(--border-default)'),
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-xs)',
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ font: 'var(--type-label)', color: 'var(--text-secondary)' }}>{label}</span>
        {icon && <Icon name={icon} size={16} style={{ color: 'var(--text-accent)' }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          style={{
            font: 'var(--type-kpi)',
            fontSize: 'var(--text-3xl)',
            color: 'var(--text-heading)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        {unit && <span style={{ font: 'var(--type-label)', color: 'var(--text-secondary)' }}>{unit}</span>}
      </div>
      {(delta || hint) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {delta && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                font: 'var(--type-caption)',
                fontWeight: 'var(--weight-semibold)',
                color: good ? 'var(--kr-success)' : 'var(--kr-error)',
              }}
            >
              <Icon name={good ? 'trending-up' : 'trending-down'} size={12} strokeWidth={2.5} />
              {delta}
            </span>
          )}
          {hint && <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{hint}</span>}
        </div>
      )}
    </div>
  )
}
