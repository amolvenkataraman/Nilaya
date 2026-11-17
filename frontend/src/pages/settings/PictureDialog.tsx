// Profile picture: pick an image, crop it square on a canvas (drag to move, slider or wheel to zoom,
// rotate in quarter turns), upload as a JPEG data URL. The server re-encodes it (POST /me/picture).
// Drawn on a canvas rather than with CSS transforms so the upload is exactly what the preview shows.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Dialog } from '../../components/ui'
import { useUploadPicture } from './api'

const OUT = 640 // exported square, px (the server keeps up to 1024)
const MAX_ZOOM = 5

// The crop square is 1 x 1 unit; offsets are in those units so the maths ignores the on-screen size.
interface View {
  zoom: number
  x: number
  y: number
  rot: 0 | 1 | 2 | 3
}

function dims(img: HTMLImageElement, rot: number) {
  const w = img.naturalWidth,
    h = img.naturalHeight
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
  const zoomTo = (z: number) =>
    update((v) => {
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
    const dx = (e.clientX - d.x) / size,
      dy = (e.clientY - d.y) / size
    drag.current = { ...d, x: e.clientX, y: e.clientY }
    update((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  const onUp = () => {
    drag.current = null
  }

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

  const upload = useUploadPicture(onClose, setError)
  const save = () => {
    const out = document.createElement('canvas')
    out.width = out.height = OUT
    const ctx = out.getContext('2d')
    if (!ctx || !img) return
    draw(ctx, img, view, OUT)
    setError('')
    upload.mutate(out.toDataURL('image/jpeg', 0.9))
  }

  const step = 0.02
  const onKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
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
      footer={
        <>
          {error ? (
            <span className="flex-1 text-xs text-danger" role="alert">
              {error}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!img || upload.isPending} onClick={save}>
            {upload.isPending ? 'Uploading…' : 'Save picture'}
          </Button>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = '' // so choosing the same file again still fires
        }}
      />
      {img ? (
        <>
          <div className="relative mx-auto aspect-square w-[min(18rem,100%)] overflow-hidden rounded-md bg-surface-2">
            <canvas
              className="block size-full cursor-grab touch-none focus-visible:outline-offset-[-2px] active:cursor-grabbing"
              ref={canvas}
              tabIndex={0}
              aria-label="Crop area: drag or use the arrow keys to move, + and - to zoom"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={onKey}
            />
            <span
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]"
              aria-hidden="true"
            />
          </div>
          <div className="mx-auto flex w-[min(18rem,100%)] items-center gap-2 text-muted">
            <Icon name="search" size={14} />
            <input
              type="range"
              className="min-w-0 flex-1 accent-accent"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={view.zoom}
              onChange={(e) => zoomTo(Number(e.target.value))}
              aria-label="Zoom"
            />
            <Button
              variant="ghost"
              size="sm"
              icon
              title="Rotate left"
              aria-label="Rotate left"
              onClick={() => update((v) => ({ ...v, rot: ((v.rot + 3) % 4) as View['rot'], x: 0, y: 0 }))}
            >
              <Icon name="refresh" size={14} className="-scale-x-100" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              title="Rotate right"
              aria-label="Rotate right"
              onClick={() => update((v) => ({ ...v, rot: ((v.rot + 1) % 4) as View['rot'], x: 0, y: 0 }))}
            >
              <Icon name="refresh" size={14} />
            </Button>
          </div>
          <Button size="sm" className="justify-self-center" onClick={() => fileInput.current?.click()}>
            Choose another image
          </Button>
        </>
      ) : (
        <button
          type="button"
          className="grid cursor-pointer justify-items-center gap-1.5 rounded-md border-[1.5px] border-dashed border-border bg-surface-2 px-4 py-10 text-sm font-medium text-fg hover:border-accent focus-visible:border-accent focus-visible:outline-none"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            pick(e.dataTransfer.files?.[0])
          }}
        >
          <Icon name="camera" size={22} className="text-muted" />
          <span>Choose an image</span>
          <span className="text-xs text-muted">or drop one here. You can crop it next.</span>
        </button>
      )}
    </Dialog>
  )
}
