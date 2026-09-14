/**
 * 16-bit pixel art, drawn as data.
 *
 * The original spec asked for pixel-art avatars and badges but no image assets
 * survive, so they are defined here as character grids: one character per
 * pixel, `.` for transparent, every other character a key into the palette.
 * That keeps them diffable, themeable and tiny, and lets them render as
 * crisp-edged SVG at any size without a single binary file.
 *
 * `spriteRects` merges horizontal runs so a 16x16 sprite is ~60 rects, not 256.
 */

import type { AvatarId, BadgeGlyph, SeasonId } from '@/lib/gamification'

export interface Sprite {
  width: number
  height: number
  rows: string[]
  palette: Record<string, string>
}

export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
  fill: string
}

export function spriteRects(sprite: Sprite): PixelRect[] {
  const rects: PixelRect[] = []
  sprite.rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const key = row[x]
      if (key === '.') {
        x += 1
        continue
      }
      let end = x + 1
      while (end < row.length && row[end] === key) end += 1
      const fill = sprite.palette[key]
      if (fill) rects.push({ x, y, w: end - x, h: 1, fill })
      x = end
    }
  })
  return rects
}

// ---------------------------------------------------------------------------
// Avatars, 16x16
// ---------------------------------------------------------------------------

/** Shared across characters so they read as one cast. */
const BASE = {
  o: '#2b1a10', // outline
  s: '#f5c9a0', // skin
  S: '#d9956a', // skin shade
  e: '#2b1a10', // eyes
  p: '#f08a8a', // cheeks
  m: '#a8503c', // mouth
  w: '#fff8ec', // highlight
}

const AVATAR_SPRITES: Record<AvatarId, Sprite> = {
  // Straw-hatted farmer in overalls.
  novice: {
    width: 16,
    height: 16,
    palette: { ...BASE, y: '#f2cf6b', Y: '#c99a3a', r: '#c8463a', h: '#8a5328', c: '#4f7fd0', C: '#3a5fa3', t: '#e9e2cf', b: '#6b3f1f' },
    rows: [
      '.....oooooo.....',
      '....oyyyyyyo....',
      '....orrrrrro....',
      '.ooyyyyyyyyyyoo.',
      '..oYYYYYYYYYYo..',
      '...ohssssssho...',
      '...osesssseso...',
      '...osesssseso...',
      '...ospsmmspso...',
      '....oSssssSo....',
      '...otcttttcto...',
      '..osccccccccso..',
      '..osccCccCccso..',
      '...occcccccco...',
      '...oCCCooCCCo...',
      '..obbbo..obbbo..',
    ],
  },

  // Cap and backpack straps.
  student: {
    width: 16,
    height: 16,
    palette: { ...BASE, b: '#3f7fbf', B: '#2c5d8f', h: '#5a3418', r: '#d9573f', R: '#a8402d', k: '#3b2a1e', d: '#46506a', f: '#2f2f3a' },
    rows: [
      '................',
      '....oooooooo....',
      '...obbbbbbbbo...',
      '...obbbwwbbbo...',
      '...ohhhBBBBBBBo.',
      '...ohssssssho...',
      '...osesssseso...',
      '...osesssseso...',
      '...ospsmmspso...',
      '....oSssssSo....',
      '...orkrrrrkro...',
      '..osrkrrrrkrso..',
      '..osrkRRRRkrso..',
      '...orrrrrrrro...',
      '...oddd..dddo...',
      '..offfo..offfo..',
    ],
  },

  // Hair bun, round glasses, a red book.
  scholar: {
    width: 16,
    height: 16,
    palette: { ...BASE, h: '#b5612e', H: '#8a4520', g: '#3b2a1e', l: '#d8eef6', v: '#5e8c4a', V: '#44683a', k: '#c23b3b', K: '#8f2a2a', d: '#5a4a3a', f: '#2f2a26' },
    rows: [
      '......oooo......',
      '.....ohHHho.....',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '...ohHhhhhHho...',
      '...ohssssssho...',
      '...ogggssgggo...',
      '...olelgglelo...',
      '...ogggssgggo...',
      '....ossmmsso....',
      '...ovvvvvvvvo...',
      '..osvvkkkkvvso..',
      '..osvvkwwkvvso..',
      '...oVVkKKkVVo...',
      '...oddd..dddo...',
      '..offfo..offfo..',
    ],
  },

  // Starry wizard hat and a silver beard.
  master: {
    width: 16,
    height: 16,
    palette: { ...BASE, v: '#6a4fb3', V: '#4b3685', y: '#ffd95a', h: '#cfd3dc', w: '#eef0f5', f: '#2f2a3a' },
    rows: [
      '........oo......',
      '.......ovvo.....',
      '......ovvvvo....',
      '.....ovvyvvvo...',
      '..oooooooooooo..',
      '...ohssssssho...',
      '...osesssseso...',
      '...osesssseso...',
      '...owwsmmswwo...',
      '...owwwwwwwwo...',
      '...ovwwwwwwvo...',
      '..osvvwwwwvvso..',
      '..osvvvyvvvvso..',
      '...oVvvvvvvVo...',
      '...oVVVVVVVVo...',
      '..offfo..offfo..',
    ],
  },

  // Gold crown, red cape, royal tunic.
  prodigy: {
    width: 16,
    height: 16,
    palette: { ...BASE, y: '#ffd24a', Y: '#d69a1c', r: '#d6443c', R: '#9e2c27', h: '#f0c04a', H: '#c9922a', j: '#3fb5d9', t: '#f4efe2', f: '#3a2a22' },
    rows: [
      '....o..oo..o....',
      '....y..yy..y....',
      '...oyyjyyjyyo...',
      '...ohhhhhhhho...',
      '...ohHhhhhHho...',
      '...ohssssssho...',
      '...osesssseso...',
      '...osesssseso...',
      '...ospsmmspso...',
      '....oSssssSo....',
      '..orttyyyyttro..',
      '.orsttyjjyttsro.',
      '.orsttyyyyttsro.',
      '.orRttttttttRro.',
      '..oRRtt..ttRRo..',
      '..offfo..offfo..',
    ],
  },
}

export function avatarSprite(id: AvatarId): Sprite {
  return AVATAR_SPRITES[id]
}

// ---------------------------------------------------------------------------
// Badge glyphs, 12x12
// ---------------------------------------------------------------------------

const G = { o: '#2b1a10', w: '#fff8ec' }

const GLYPHS: Record<BadgeGlyph, Sprite> = {
  sprout: {
    width: 12, height: 12,
    palette: { ...G, g: '#6cc04a', G: '#3f8a34', b: '#8a5328', B: '#6b3f1f' },
    rows: [
      '............',
      '..oo....oo..',
      '.oggo..oggo.',
      '.ogGgooGggo.',
      '..oGGggGGo..',
      '...ooggoo...',
      '.....oo.....',
      '.....Go.....',
      '..oooooooo..',
      '.obbbbbbbbo.',
      '.oBBBBBBBBo.',
      '..oooooooo..',
    ],
  },
  book: {
    width: 12, height: 12,
    palette: { ...G, r: '#d6443c', R: '#9e2c27', p: '#f4efe2', P: '#d8cfb8' },
    rows: [
      '............',
      '.oooooooooo.',
      '.orrrrrrrrpo',
      '.orrwwwwrrpo',
      '.orrrrrrrrpo',
      '.orrwwwwrrpo',
      '.orrrrrrrrpo',
      '.orrrrrrrrpo',
      '.oRRRRRRRRPo',
      '.oppppppppPo',
      '..oooooooooo',
      '............',
    ],
  },
  trophy: {
    width: 12, height: 12,
    palette: { ...G, y: '#ffd24a', Y: '#d69a1c', b: '#8a5328' },
    rows: [
      '.oooooooooo.',
      'oyoywyyyyoyo',
      'oyoywyyyyoyo',
      '.ooyyyyyyoo.',
      '...oyyyyo...',
      '....oYYo....',
      '.....oo.....',
      '....oyyo....',
      '...oyyyyo...',
      '..oooooooo..',
      '..obbbbbbo..',
      '..oooooooo..',
    ],
  },
  flame: {
    width: 12, height: 12,
    palette: { ...G, r: '#e2502f', y: '#ffc83a', Y: '#fff1a8' },
    rows: [
      '.....o......',
      '....oro.....',
      '....orro.o..',
      '...orrrooro.',
      '..orryrrrro.',
      '..orryyrrro.',
      '.orryyyyrrro',
      '.oryyYYyyrro',
      '.oryYYYYyro.',
      '.oryYYYYyro.',
      '..orryyrro..',
      '...oooooo...',
    ],
  },
  sun: {
    width: 12, height: 12,
    palette: { ...G, y: '#ffd24a', Y: '#f2a93b' },
    rows: [
      '.....yy.....',
      '.y...yy...y.',
      '..y......y..',
      '....oooo....',
      '...oyyyyo...',
      'yy.oywyyo.yy',
      'yy.oyyyYo.yy',
      '...oyyYYo...',
      '....oooo....',
      '..y......y..',
      '.y...yy...y.',
      '.....yy.....',
    ],
  },
  gem: {
    width: 12, height: 12,
    palette: { ...G, c: '#5ac8e8', C: '#2e8fb8', d: '#1f6a8c' },
    rows: [
      '............',
      '...oooooo...',
      '..ocwccccco.',
      '.ocwcccCCCCo',
      'occcccCCCCCo',
      'oooooooooooo',
      '.oCCCCdddddo',
      '..oCCCdddo..',
      '...oCCddo...',
      '....oCdo....',
      '.....oo.....',
      '............',
    ],
  },
  star: {
    width: 12, height: 12,
    palette: { ...G, y: '#ffd24a', Y: '#d69a1c' },
    rows: [
      '.....oo.....',
      '....oyyo....',
      '....oyyo....',
      'oooooywyoooo',
      'oyyyyyyyyyyo',
      '.oyyyyyyyyo.',
      '..oyyyyyyo..',
      '..oyyYYyyo..',
      '.oyyYooYyyo.',
      '.oyYo..oYyo.',
      'oyYo....oYyo',
      'ooo......ooo',
    ],
  },
  apple: {
    width: 12, height: 12,
    palette: { ...G, r: '#d6443c', R: '#9e2c27', g: '#6cc04a', b: '#6b3f1f' },
    rows: [
      '......o.....',
      '.....obooo..',
      '.....obggo..',
      '..ooooooo...',
      '.orrrrrrrro.',
      'orwwrrrrrrro',
      'orwrrrrrrrro',
      'orrrrrrrrrRo',
      'orrrrrrrrRRo',
      '.orrrrrrRRo.',
      '..orrooRRo..',
      '...oo..oo...',
    ],
  },
  chest: {
    width: 12, height: 12,
    palette: { ...G, b: '#a8672e', B: '#7a4a22', y: '#ffd24a' },
    rows: [
      '............',
      '..oooooooo..',
      '.obbbbbbbbo.',
      'obbbbbbbbbbo',
      'oBBBBBBBBBBo',
      'oyyyyooyyyyo',
      'obbbboyobbbo',
      'obbbbooobbbo',
      'obbbbbbbbbbo',
      'oBBBBBBBBBBo',
      'oyyyyyyyyyyo',
      'oooooooooooo',
    ],
  },
}

export function glyphSprite(glyph: BadgeGlyph): Sprite {
  return GLYPHS[glyph]
}

// ---------------------------------------------------------------------------
// Seasonal landscape
// ---------------------------------------------------------------------------

interface SceneColors {
  sky: [string, string, string, string]
  sun: string | null
  cloud: string | null
  farHill: string
  nearHill: string
  ground: string
  groundShade: string
  trunk: string
  canopy: string
  canopyShade: string
  dots: string[]
  fence: string
  flakes: string | null
}

const SCENES: Record<SeasonId, SceneColors> = {
  spring: {
    sky: ['#8fd3f4', '#a6ddf6', '#bfe7f8', '#d8f1fa'],
    sun: '#fff1a8', cloud: '#ffffff',
    farHill: '#9ccf7e', nearHill: '#7cbd5c', ground: '#6aae4c', groundShade: '#579a3d',
    trunk: '#7a4a22', canopy: '#78c25a', canopyShade: '#f3a6c8',
    dots: ['#f7a6c9', '#ffe36e', '#ffffff'], fence: '#a8672e', flakes: null,
  },
  summer: {
    sky: ['#4fb3e8', '#6cc2ee', '#8dd1f2', '#b3e2f6'],
    sun: '#ffd84a', cloud: '#f4fbff',
    farHill: '#6fb04e', nearHill: '#4f9a3a', ground: '#45902f', groundShade: '#367a25',
    trunk: '#6b3f1f', canopy: '#3f8f33', canopyShade: '#2f7228',
    dots: ['#ffd84a', '#e2502f', '#7ad05a'], fence: '#9a5e2a', flakes: null,
  },
  autumn: {
    sky: ['#f2b27a', '#f5c48f', '#f8d4a6', '#fae3c0'],
    sun: '#ffe08a', cloud: '#fff4e2',
    farHill: '#c98b4a', nearHill: '#b27238', ground: '#a1652f', groundShade: '#875225',
    trunk: '#5e3518', canopy: '#e2702f', canopyShade: '#c2402b',
    dots: ['#e2702f', '#f2c14e', '#c2402b'], fence: '#7a4a22', flakes: null,
  },
  winter: {
    sky: ['#7a8fb8', '#93a6c9', '#adbed9', '#c9d6e8'],
    sun: null, cloud: '#e8eef7',
    farHill: '#dfe8f2', nearHill: '#eef3f8', ground: '#f7fafc', groundShade: '#cddbe8',
    trunk: '#5a3a24', canopy: '#2f6a55', canopyShade: '#f4f8fb',
    dots: ['#cddbe8'], fence: '#6b4a32', flakes: '#ffffff',
  },
}

/** Deterministic so the server and browser draw the same flowers. */
function mulberry32(seed: number) {
  let t = seed
  return () => {
    t |= 0
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A Stardew-style strip: banded sky, rolling hills, a fence, trees and
 * season-specific ground cover. Returned as merged rects in a grid of
 * `width` by `height` pixels.
 */
export function sceneRects(season: SeasonId, width = 200, height = 40): PixelRect[] {
  const c = SCENES[season]
  const rnd = mulberry32(season.length * 7919 + width)
  const grid: (string | null)[][] = Array.from({ length: height }, () => Array(width).fill(null))
  const put = (x: number, y: number, fill: string | null) => {
    if (fill && x >= 0 && x < width && y >= 0 && y < height) grid[y][x] = fill
  }

  // Sky bands with a one-row checker dither between them.
  const band = Math.ceil(height / 4)
  for (let y = 0; y < height; y += 1) {
    const i = Math.min(3, Math.floor(y / band))
    for (let x = 0; x < width; x += 1) {
      const dither = y % band === 0 && i > 0 && (x + y) % 2 === 0
      put(x, y, c.sky[dither ? i - 1 : i])
    }
  }

  // Sun.
  if (c.sun) {
    const cx = Math.round(width * 0.82)
    const cy = 8
    for (let y = -4; y <= 4; y += 1)
      for (let x = -4; x <= 4; x += 1)
        if (x * x + y * y <= 17) put(cx + x, cy + y, c.sun)
  }

  // Clouds: three stacked ovals each.
  if (c.cloud) {
    for (const [cx, cy] of [[Math.round(width * 0.18), 7], [Math.round(width * 0.55), 5], [Math.round(width * 0.95), 11]]) {
      for (let x = -6; x <= 6; x += 1) put(cx + x, cy + 1, c.cloud)
      for (let x = -4; x <= 4; x += 1) put(cx + x, cy, c.cloud)
      for (let x = -2; x <= 2; x += 1) put(cx + x - 1, cy - 1, c.cloud)
    }
  }

  const far = (x: number) => Math.round(height * 0.52 + 3 * Math.sin(x / 11) + 2 * Math.sin(x / 4.7 + 1))
  const near = (x: number) => Math.round(height * 0.68 + 2 * Math.sin(x / 8 + 2) + Math.sin(x / 3.1))

  for (let x = 0; x < width; x += 1) {
    for (let y = far(x); y < height; y += 1) put(x, y, c.farHill)
    for (let y = near(x); y < height; y += 1) put(x, y, y === near(x) ? c.nearHill : c.ground)
    // Shade the lowest rows so the strip sits on something.
    for (let y = height - 3; y < height; y += 1) if ((x + y) % 3 !== 0) put(x, y, c.groundShade)
  }

  // Fence along the near hill.
  for (let x = 0; x < width; x += 1) {
    const top = near(x) - 4
    put(x, top + 1, c.fence)
    if (x % 6 === 0) for (let y = top; y < near(x); y += 1) put(x, y, c.fence)
  }

  // Trees: trunk plus a rounded canopy, with season accent pixels.
  const treeXs = [0.07, 0.3, 0.46, 0.7, 0.9].map((f) => Math.round(width * f))
  for (const tx of treeXs) {
    const base = far(tx)
    for (let y = base - 4; y <= base + 1; y += 1) put(tx, y, c.trunk)
    const top = base - 11
    for (let y = 0; y < 8; y += 1) {
      const half = y < 2 ? 2 + y : y > 5 ? 9 - y : 4
      for (let x = -half; x <= half; x += 1) {
        const accent = rnd() < (season === 'winter' ? (y < 3 ? 0.8 : 0.15) : 0.18)
        put(tx + x, top + y, accent ? c.canopyShade : c.canopy)
      }
    }
  }

  // Ground cover: flowers, grass tips, leaves or snow texture.
  for (let x = 1; x < width; x += 1) {
    if (rnd() < 0.22) {
      const y = near(x) + 1 + Math.floor(rnd() * Math.max(1, height - near(x) - 4))
      put(x, y, c.dots[Math.floor(rnd() * c.dots.length)])
    }
  }

  // Falling snow.
  if (c.flakes) {
    for (let i = 0; i < width * 0.35; i += 1) {
      put(Math.floor(rnd() * width), Math.floor(rnd() * (height * 0.6)), c.flakes)
    }
  }

  const rects: PixelRect[] = []
  grid.forEach((row, y) => {
    let x = 0
    while (x < width) {
      const fill = row[x]
      let end = x + 1
      while (end < width && row[end] === fill) end += 1
      if (fill) rects.push({ x, y, w: end - x, h: 1, fill })
      x = end
    }
  })
  return rects
}

/**
 * Rects grouped into one path per colour. A landscape is ~1,400 rects but only
 * ~20 colours, so this keeps each scene to a couple of dozen DOM nodes.
 */
export function rectsToPaths(rects: PixelRect[]): { fill: string; d: string }[] {
  const byFill = new Map<string, string[]>()
  for (const r of rects) {
    const list = byFill.get(r.fill) ?? []
    list.push(`M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`)
    byFill.set(r.fill, list)
  }
  return [...byFill.entries()].map(([fill, parts]) => ({ fill, d: parts.join('') }))
}
