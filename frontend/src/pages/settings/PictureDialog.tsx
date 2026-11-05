// Profile picture: pick an image, crop it square on a canvas (drag to move, slider or wheel to zoom,
// rotate in quarter turns), upload as a JPEG data URL. The server re-encodes it (POST /me/picture).
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Dialog } from '../../components/ui'
import { toast } from '../../components/toast'
import { post } from '../../lib/api'
import { keys } from '../../lib/queries'
import type { Me } from '../../lib/types'

const OUT = 640 // exported square, px (the server keeps up to 1024)
const MAX_ZOOM = 5

// The crop square is 1 x 1 unit; offsets are in those units so the maths ignores the on-screen size.
interface View { zoom: number; x: number; y: number; rot: 0 | 1 | 2 | 3 }

function dims(img: HTMLImageElement, rot: number) {
  const w = img.naturalWidth, h = img.naturalHeight
  return rot % 2 ? { w: h, h: w } : { w, h }
}

/** Keep the image covering the whole square. */
function clamp(img: HTMLImageElement, v: View): View {
  const { w, h } = dims(img, v.rot)
  const s = Math.max(1 / w, 1 / h) * v.zoom
  const mx = Math.max(0, (w * s - 1) / 2)
  const my = Math.max(0, (h * s - 1) / 2)
  return { ...v, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) }
}

function draw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, v: View, size: number) {
  const { w, h } = dims(img, v.rot)
  const s = Math.max(1 / w, 1 / h) * v.zoom * size
  ctx.save()
  ctx.fillStyle = '#fff' // transparent PNGs become JPEGs
  ctx.fillRect(0, 0, size, size)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(size / 2 + v.x * size, size / 2 + v.y * size)
  ctx.rotate((v.rot * Math.PI) / 2)
  ctx.scale(s, s)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  ctx.restore()
}

export function PictureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0, rot: 0 })
  const [error, setError] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setImg(null)
      setError('')
    }
  }, [open])

  const paint = useCallback(() => {
    const c = canvas.current
    if (!c || !img) return
    const px = Math.round(c.clientWidth * (window.devicePixelRatio || 1))
    if (c.width !== px) c.width = c.height = px
    const ctx = c.getContext('2d')
    if (ctx) draw(ctx, img, view, px)
  }, [img, view])
  useEffect(paint, [paint])
  useEffect(() => {
    window.addEventListener('resize', paint)
    return () => window.removeEventListener('resize', paint)
  }, [paint])

  const pick = (file: File | undefined) => {
    setError('')
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Choose an image file (JPEG, PNG, WebP…).')
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => {
      URL.revokeObjectURL(url)
      setView({ zoom: 1, x: 0, y: 0, rot: 0 })
      setImg(el)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      setError("That image couldn't be read. Try a JPEG or PNG.")
    }
    el.src = url
  }

  const update = (fn: (v: View) => View) => img && setView((v) => clamp(img, fn(v)))
  const zoomTo = (z: number) => update((v) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, z))
    return { ...v, zoom, x: (v.x * zoom) / v.zoom, y: (v.y * zoom) / v.zoom } // zoom about the centre
  })

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!img) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const size = e.currentTarget.clientWidth || 1
    const dx = (e.clientX - d.x) / size, dy = (e.clientY - d.y) / size
    drag.current = { ...d, x: e.clientX, y: e.clientY }
    update((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  const onUp = () => (drag.current = null)

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const c = canvas.current
    if (!c || !img) return
    const h = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
        return clamp(img, { ...v, zoom, x: (v.x * zoom) / v.zoom, y: (v.y * zoom) / v.zoom })
      })
    }
    c.addEventListener('wheel', h, { passive: false })
    return () => c.removeEventListener('wheel', h)
  }, [img])

  const upload = useMutation({
    mutationFn: () => {
      const out = document.createElement('canvas')
      out.width = out.height = OUT
      const ctx = out.getContext('2d')
      if (!ctx || !img) throw new Error('Nothing to upload')
      draw(ctx, img, view, OUT)
      return post<Me>('me/picture', { data_url: out.toDataURL('image/jpeg', 0.9) })
    },
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me)
      qc.invalidateQueries({ queryKey: ['users', me.username] })
      toast.show('Profile picture updated')
      onClose()
    },
    onError: (e) => setError((e as Error).message),
  })

  const step = 0.02
  const onKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const m = moves[e.key]
    if (m) {
      e.preventDefault()
      update((v) => ({ ...v, x: v.x + m[0], y: v.y + m[1] }))
    } else if (e.key === '+' || e.key === '=') zoomTo(view.zoom * 1.1)
    else if (e.key === '-') zoomTo(view.zoom / 1.1)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change your profile picture"
      width="26rem"
      labelledBy="pic-title"
      footer={
        <>
          {error ? <span className="error-text grow" role="alert">{error}</span> : <span className="spacer" />}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!img || upload.isPending} onClick={() => (setError(''), upload.mutate())}>
            {upload.isPending ? 'Uploading…' : 'Save picture'}
          </button>
        </>
      }
    >
      <div className="stack pic-body">
        <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
        {img ? (
          <>
            <div className="crop-stage">
              <canvas
                ref={canvas}
                tabIndex={0}
                aria-label="Crop area: drag or use the arrow keys to move, + and - to zoom"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onKeyDown={onKey}
              />
              <span className="crop-ring" aria-hidden="true" />
            </div>
            <div className="crop-tools">
              <Icon name="search" size={14} />
              <input
                type="range"
                className="crop-zoom"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={view.zoom}
                onChange={(e) => zoomTo(Number(e.target.value))}
                aria-label="Zoom"
              />
              <button type="button" className="btn ghost icon sm" title="Rotate left" aria-label="Rotate left" onClick={() => update((v) => ({ ...v, rot: ((v.rot + 3) % 4) as View['rot'], x: 0, y: 0 }))}>
                <Icon name="refresh" size={14} className="flip-x" />
              </button>
              <button type="button" className="btn ghost icon sm" title="Rotate right" aria-label="Rotate right" onClick={() => update((v) => ({ ...v, rot: ((v.rot + 1) % 4) as View['rot'], x: 0, y: 0 }))}>
                <Icon name="refresh" size={14} />
              </button>
            </div>
            <button type="button" className="btn sm pic-other" onClick={() => fileInput.current?.click()}>Choose another image</button>
          </>
        ) : (
          <button
            type="button"
            className="pic-drop"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => (e.preventDefault(), pick(e.dataTransfer.files?.[0]))}
          >
            <Icon name="camera" size={22} />
            <span>Choose an image</span>
            <span className="help">or drop one here. You can crop it next.</span>
          </button>
        )}
      </div>
    </Dialog>
  )
}
