// A drop zone that is also a button: drop a file on it, or click / press Enter to pick one. Compact once a
// file is chosen. Built for the contacts import; meant for components/ui (places import, profile picture).
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function FileDrop({
  accept,
  onFile,
  compact,
  children,
}: {
  accept: string
  onFile: (f: File | undefined) => void
  /** A file is chosen: one line instead of the big target. */
  compact?: boolean
  children: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const enter = (e: DragEvent) => {
    e.preventDefault()
    setOver(true)
  }
  return (
    <>
      <button
        type="button"
        className={cn(
          'cursor-pointer justify-items-center gap-1.5 rounded-md border-[1.5px] border-dashed px-4 text-center text-sm text-muted transition-colors',
          'hover:border-accent hover:bg-accent-soft [&_strong]:font-medium [&_strong]:text-fg',
          over ? 'border-accent bg-accent-soft' : 'border-[color-mix(in_srgb,var(--app-muted)_45%,var(--app-border))] bg-surface-2',
          compact ? 'flex justify-center py-2.5' : 'grid py-8',
        )}
        onClick={() => input.current?.click()}
        onDragEnter={enter}
        onDragOver={enter}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onFile(e.dataTransfer.files[0])
        }}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )
}
