/**
 * Generates web-sized brand assets from the print-resolution originals in
 * `frontend/public/assets/`.
 *
 * The originals are the source of truth and are left untouched — but they are
 * 1024x1024 and 1659x465 masters, and the app was serving them raw. The
 * favicon alone was 1,025,543 bytes to fill a 16px tab slot, and the sidebar
 * lockup 970,861 bytes to render about 200px wide, on every authenticated
 * page load.
 *
 * Each target below is roughly 2x its largest rendered size, which is what a
 * retina display can actually resolve. `Logo.tsx` and `index.html` reference
 * the generated files; the originals stay for print and for regenerating.
 *
 * Requires ImageMagick 7 (`magick` on PATH).
 *
 * Run from the repo root:
 *   node tools/resize-brand-assets.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'frontend', 'public', 'assets')

/**
 * [source, output, geometry, why]
 *
 * Geometry is ImageMagick's `-resize`: "64x64" fits inside the box preserving
 * aspect ratio, "x128" constrains height only.
 */
const TARGETS = [
  ['favicon.png', 'favicon-64.png', '64x64', 'browser tab, 16-32px at up to 2x'],
  ['favicon.png', 'apple-touch-icon.png', '180x180', 'iOS home screen, fixed 180px'],
  ['logo-horizontal-navy.png', 'logo-horizontal-navy-web.png', 'x128', 'sidebar lockup and login, up to 48px tall at 2x'],
  ['logo-horizontal.png', 'logo-horizontal-web.png', 'x128', 'light-surface lockup'],
  ['logo-horizontal-mono.png', 'logo-horizontal-mono-web.png', 'x128', 'single-colour lockup'],
  ['logo-stacked-light.png', 'logo-stacked-light-web.png', 'x320', 'login and print, largest on-screen use'],
  ['logo-mark.png', 'logo-mark-web.png', '128x128', 'outlined mark, 36px at up to 3x'],
  ['logo-mark-solid.png', 'logo-mark-solid-web.png', '128x128', 'collapsed sidebar mark, 36px at up to 3x'],
  // Renders inside a 320px-max card with 16px padding, so ~288px wide.
  // Deliberately loaded eagerly on the landing page with its aspect ratio
  // reserved (see LandingPage.tsx) — the fix for its weight is fewer pixels,
  // not lazy-loading, which would reintroduce the layout shift that comment
  // records.
  // WebP, unlike the logos: this is a photographic screenshot, and PNG can
  // only get it to 657KB where WebP reaches 37KB with nothing visible lost.
  // The logos stay PNG because flat-colour artwork with hard edges is
  // exactly what PNG is good at, and they are already small once resized.
  ['app-home-preview.png', 'app-home-preview-web.webp', '640x', 'landing app mockup, ~288px wide at 2x'],
]

try {
  execFileSync('magick', ['-version'], { stdio: 'ignore' })
} catch {
  console.error('ImageMagick 7 is required and `magick` was not found on PATH.')
  console.error('Install it, or regenerate these files with any image tool at the sizes listed in TARGETS.')
  process.exit(1)
}

let before = 0
let after = 0

for (const [src, out, geometry, why] of TARGETS) {
  const srcPath = join(ASSETS, src)
  const outPath = join(ASSETS, out)
  if (!existsSync(srcPath)) {
    console.error(`missing source: ${src} — skipped`)
    continue
  }

  const webp = out.endsWith('.webp')
  execFileSync('magick', [
    srcPath,
    '-resize',
    geometry,
    // Drop colour profiles and EXIF; they are a meaningful share of a small file.
    '-strip',
    ...(webp
      ? ['-quality', '82', '-define', 'webp:method=6']
      : ['-define', 'png:compression-level=9']),
    outPath,
  ])

  const from = statSync(srcPath).size
  const to = statSync(outPath).size
  before += from
  after += to
  console.log(`${out.padEnd(34)} ${String(to).padStart(8)}B  from ${String(from).padStart(8)}B  (${why})`)
}

console.log(`\ntotal ${before}B of masters -> ${after}B shipped`)
