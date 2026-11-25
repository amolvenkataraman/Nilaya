// Photos › one album: a banner (cover, name, visibility, counts and date span, copy link / edit / share /
// delete for the owner) over the album's photo stream. A public album you aren't a member of gets a plain
// heading from the public endpoint instead. While open, the album is the selection bar's and viewer's context.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, buttonClass, chipClass, Confirm, Menu, MenuItem, pageClass, PageHead } from '../../components/ui'
import { get } from '../../lib/api'
import { plural } from '../../lib/format'
import { useMe } from '../../lib/queries'
import type { Schemas } from '../../lib/types'
import { copyLinks, deleteAlbum, useAlbums } from './actions'
import { AlbumCover } from './AlbumCover'
import { AlbumDialog } from './AlbumDialog'
import { albumMeta, albumSpan, publicAlbumUrl } from './albumText'
import { PhotoStream, type Zoom } from './PhotoStream'
import { albumContext } from './selection'
import { ShareDialog } from './ShareDialog'

type PublicAlbum = Schemas['PublicAlbumOut']

/** Button labels give way to icons on phones. */
const label = 'max-md:hidden'

export function AlbumPage({ zoom }: { zoom: Zoom }) {
  const { id = '' } = useParams()
  const albums = useAlbums()
  const me = useMe().data
  const album = albums.data?.find((a) => a.id === id)
  const valid = /^[0-9a-f-]{36}$/i.test(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    albumContext.set(album ?? null)
    return () => albumContext.set(null)
  }, [album])
  const link = publicAlbumUrl(id)
  // A public album you aren't in isn't in your list: its name and owner come from the public endpoint.
  const outside = useQuery({
    queryKey: ['photos', 'public-album', id],
    queryFn: ({ signal }) => get<PublicAlbum>(`photos/public/albums/${id}`, undefined, signal),
    enabled: valid && albums.isSuccess && !album,
    staleTime: 10 * 60_000,
    retry: false,
  }).data
  return (
    <div className={pageClass(true)}>
      {album ? (
        <header className="mb-4 flex items-center gap-3.5 rounded-md border border-border bg-surface p-3 max-md:flex-wrap max-md:gap-2.5 max-md:p-2.5">
          <Link
            to="/photos/albums"
            className={buttonClass({ variant: 'ghost', icon: true, className: 'max-md:hidden' })}
            aria-label="Back to albums"
            title="Back to albums"
          >
            <Icon name="chevronLeft" size={18} />
          </Link>
          <AlbumCover album={album} icon={28} lazy={false} className="size-18 rounded-sm text-muted max-md:size-14" />
          <div className="grid min-w-0 flex-1 gap-0.75">
            <div className="flex min-w-0 items-center gap-2 max-md:flex-wrap max-md:gap-y-1">
              {/* Not `truncate`: the old global .truncate would keep nowrap on phones, where the name wraps. */}
              <h1 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap max-md:basis-full max-md:whitespace-normal max-md:[overflow-wrap:anywhere]">
                {album.name}
              </h1>
              <span className={chipClass({ tone: album.public ? 'accent' : 'neutral' })}>{album.public ? 'Public' : 'Private'}</span>
              <span className={chipClass()}>{album.mine ? 'Owner' : 'Shared with you'}</span>
            </div>
            {album.description && <p className="m-0 line-clamp-2 text-sm text-fg [overflow-wrap:anywhere]">{album.description}</p>}
            <p className="m-0 text-xs text-muted tabular-nums">
              {[albumMeta({ ...album, owner: album.owner ?? (album.mine ? me?.username : undefined) }), albumSpan(album)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex flex-none items-center gap-1.5 max-md:basis-full">
            {album.public && (
              <Button size="sm" onClick={() => copyLinks([link])} title="Copy a link to this album">
                <Icon name="link" size={14} />
                <span className={label}>Copy link</span>
              </Button>
            )}
            {album.mine && (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>
                  <Icon name="edit" size={14} />
                  <span className={label}>Edit</span>
                </Button>
                <Button variant="primary" size="sm" onClick={() => setSharing(true)}>
                  <Icon name="users" size={14} />
                  <span className={label}>Share</span>
                </Button>
                <Menu
                  align="end"
                  label="More album actions"
                  trigger={(p) => (
                    <button
                      {...p}
                      type="button"
                      className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })}
                      aria-label="More album actions"
                      title="More"
                    >
                      <Icon name="more" size={16} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        icon="link"
                        onClick={() => {
                          close()
                          copyLinks([link])
                        }}
                      >
                        Copy album link
                      </MenuItem>
                      <MenuItem
                        icon="trash"
                        danger
                        onClick={() => {
                          close()
                          setDeleting(true)
                        }}
                      >
                        Delete album
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </>
            )}
          </div>
        </header>
      ) : (
        <PageHead
          back="/photos/albums"
          title={
            albums.isPending ? (
              <span className="inline-block h-4 w-40 animate-[sk_1.3s_ease-in-out_infinite] rounded-xs bg-surface-2" />
            ) : (
              (outside?.name ?? 'Album')
            )
          }
          sub={
            outside
              ? [
                  `Public album by ${outside.owner}`,
                  plural(outside.photos, 'photo'),
                  outside.videos ? plural(outside.videos, 'video') : '',
                  albumSpan(outside),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : undefined
          }
        >
          {outside && (
            <Button size="sm" onClick={() => copyLinks([link])}>
              <Icon name="link" size={14} />
              <span>Copy link</span>
            </Button>
          )}
        </PageHead>
      )}
      {valid ? (
        <PhotoStream
          queryKey={['photos', 'album', id]}
          path={`photos/albums/${id}/photos`}
          zoom={zoom}
          empty={album?.mine ? 'This album is empty. Select photos in the timeline and choose "Add to album".' : 'This album is empty.'}
        />
      ) : (
        <div className="p-4 text-sm text-muted">Album not found.</div>
      )}
      {editing && album && <AlbumDialog album={album} onClose={() => setEditing(false)} />}
      {sharing && album && <ShareDialog album={album} onClose={() => setSharing(false)} />}
      <Confirm
        open={deleting}
        onClose={() => setDeleting(false)}
        title={album ? `Delete "${album.name}"?` : 'Delete album?'}
        confirmLabel="Delete album"
        body={`The album goes away for everyone it's shared with. Its ${album ? plural(album.count, 'photo') : 'photos'} stay in your library.`}
        onConfirm={() => {
          if (!album) return
          // Leave first, so the album's stream doesn't refetch a deleted album.
          navigate('/photos/albums', { replace: true })
          deleteAlbum(qc, album).then(
            () => toast.show(`Deleted "${album.name}"`),
            (e) => toast.fail(e),
          )
        }}
      />
    </div>
  )
}
