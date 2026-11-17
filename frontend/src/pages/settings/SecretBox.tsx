// A secret shown once (a new API key, a new feed address) with a Copy button. Where the clipboard is blocked
// the text is selected instead, for Ctrl+C; never a toast, so the secret doesn't linger on screen.
import { useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { copyText } from '../../lib/clipboard'

export function SecretBox({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState<'' | 'ok' | 'manual'>('')
  const copy = async () => {
    const ok = await copyText(value)
    if (!ok && ref.current) window.getSelection()?.selectAllChildren(ref.current)
    setCopied(ok ? 'ok' : 'manual')
    setTimeout(() => setCopied(''), 2000)
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="sr-only">{label}</span>
      <code
        ref={ref}
        className="min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-2.5 py-1.75 font-mono text-xs wrap-anywhere select-all"
      >
        {value}
      </code>
      <Button size="sm" onClick={copy}>
        <Icon name={copied === 'ok' ? 'check' : 'copy'} size={14} />
        {copied === 'ok' ? 'Copied' : copied === 'manual' ? 'Press Ctrl+C' : 'Copy'}
      </Button>
    </div>
  )
}
