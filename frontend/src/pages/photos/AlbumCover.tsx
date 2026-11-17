// An album's cover thumbnail, or the album glyph when it has none. One component for the album grid, the list
// rows, the "Add to album" picker and the album page banner; the caller sets the size and shape.
import { Icon } from '../../components/Icon'
import { safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { Album } from '../../lib/types'

export function AlbumCover({
  album,
  className,
  icon = 16,
  lazy = true,
}: {
  album: Pick<Album, 'cover'>
  /** Size, radius, colour (and a hover zoom for cards). */
  className?: string
  icon?: number
  lazy?: boolean
}) {
  const src = album.cover ? safeHref(album.cover.thumb_url) : null
  return (
    <span className={cn('grid flex-none place-items-center overflow-hidden bg-surface-2', className)}>
      {src ? (
        <img src={src} alt="" loading={lazy ? 'lazy' : undefined} decoding="async" className="size-full object-cover" />
      ) : (
        <Icon name="album" size={icon} />
      )}
    </span>
  )
}
