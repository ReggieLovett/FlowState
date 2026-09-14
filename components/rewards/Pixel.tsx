import {
  avatarSprite,
  glyphSprite,
  rectsToPaths,
  sceneRects,
  spriteRects,
  type Sprite,
} from '@/lib/pixel-art'
import type { AvatarId, BadgeGlyph as GlyphId, SeasonId } from '@/lib/gamification'

/**
 * Pixel-art primitives. No hooks and no browser APIs, so they render in Server
 * Components, in client islands, and identically in both.
 */

function SpriteSvg({
  sprite,
  size,
  label,
  className = '',
}: {
  sprite: Sprite
  size: number | string
  label?: string
  className?: string
}) {
  return (
    <svg
      viewBox={`0 0 ${sprite.width} ${sprite.height}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={`pixel-sprite ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {rectsToPaths(spriteRects(sprite)).map((path) => (
        <path key={path.fill} fill={path.fill} d={path.d} />
      ))}
    </svg>
  )
}

export function PixelAvatar({
  id,
  size = 48,
  label,
  className,
}: {
  id: AvatarId
  size?: number | string
  label?: string
  className?: string
}) {
  return <SpriteSvg sprite={avatarSprite(id)} size={size} label={label} className={className} />
}

export function PixelGlyph({
  glyph,
  size = 24,
  label,
  className,
}: {
  glyph: GlyphId
  size?: number | string
  label?: string
  className?: string
}) {
  return <SpriteSvg sprite={glyphSprite(glyph)} size={size} label={label} className={className} />
}

/** Decorative: the season name is always written next to it. */
export function PixelScene({ season, className = '' }: { season: SeasonId; className?: string }) {
  return (
    <svg
      viewBox="0 0 200 40"
      preserveAspectRatio="xMidYMax slice"
      shapeRendering="crispEdges"
      className={`pixel-scene-art ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {rectsToPaths(sceneRects(season)).map((path) => (
        <path key={path.fill} fill={path.fill} d={path.d} />
      ))}
    </svg>
  )
}
