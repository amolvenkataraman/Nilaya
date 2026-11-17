// What the Photos action bar and viewer act on: the selected photos (one store for the timeline, albums, day
// pages and search) and the album being viewed (so they can offer "Set as cover" / "Remove from album").
import type { Album, Photo } from '../../lib/types'
import { createSelection, createStore } from './store'

export const selection = createSelection<Photo>((p) => p.id)

/** The album page sets this while it's open. */
export const albumContext = createStore<Album | null>(null)
