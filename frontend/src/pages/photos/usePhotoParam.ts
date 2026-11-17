// Open and close the photo viewer through ?photo=<id>, so Back closes it and a link opens it. `source` says
// which strip opened it (e.g. 'otd' for On this day), so only that strip renders the viewer.
import { useLocation, useNavigate, useSearchParams } from 'react-router'

export function usePhotoParam() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const current = params.get('photo')
  const withPhoto = (id: string | null) => {
    const p = new URLSearchParams(location.search)
    if (id) p.set('photo', id)
    else p.delete('photo')
    const qs = p.toString()
    return location.pathname + (qs ? `?${qs}` : '')
  }
  const state = location.state as { viewer?: boolean; source?: string } | null
  const source = state?.source ?? null
  const open = (id: string, from?: string) => navigate(withPhoto(id), { state: { viewer: true, source: from } })
  const go = (id: string) => navigate(withPhoto(id), { replace: true, state: location.state })
  const close = () => {
    if (state?.viewer) navigate(-1)
    else navigate(withPhoto(null), { replace: true })
  }
  return { current, source, open, go, close }
}
