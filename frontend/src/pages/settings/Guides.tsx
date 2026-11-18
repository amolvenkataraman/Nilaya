// Settings › Guides: one Markdown guide per app (concepts, endpoints, schemas) to open, copy into an AI agent or
// download, plus links to the interactive API docs and the OpenAPI schema.
import { useState } from 'react'
import { Button, buttonClass, CardBody, cardClass, ErrorBox, SettingsSection, SkeletonRows } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { apiUrl } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { fetchGuide, useKeyApps } from './api'

const newTab = { target: '_blank', rel: 'noopener noreferrer' } as const

export function GuidesSection() {
  const apps = useKeyApps()
  const [copied, setCopied] = useState('')
  // Not toast.copy: on a blocked clipboard it would put a whole guide in a toast.
  const copy = async (app: string) => {
    try {
      if (!(await copyText(await fetchGuide(app)))) throw new Error('blocked')
      setCopied(app)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      toast.error('Copy failed, open it instead.')
    }
  }
  const download = async (app: string) => {
    try {
      const url = URL.createObjectURL(new Blob([await fetchGuide(app)], { type: 'text/markdown;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `nilaya-${app}-guide.md`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast.fail(e)
    }
  }
  const curl = `curl -H "Authorization: Bearer YOUR_API_KEY" ${location.origin}${apiUrl('tasks/', { view: 'today' })}`
  const ghost = buttonClass({ variant: 'ghost', size: 'sm', className: 'hover:no-underline' })
  return (
    <SettingsSection
      id="set-guides"
      title="Developers: guides for developers and AI agents"
      description={
        <>
          One Markdown guide per app: concepts, every endpoint and the JSON schemas. To let an AI agent (or a script) use an app, give it
          that app's guide plus an <a href="#set-api">API key</a> with access to that app. Send the key as{' '}
          <code>Authorization: Bearer &lt;key&gt;</code> or <code>X-API-Key: &lt;key&gt;</code>.
        </>
      }
    >
      <div className={cardClass}>
        {apps.data ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
            {apps.data.map((a) => (
              <div key={a.app} className="-mt-px flex items-center gap-1 border-t border-border py-1.5 pr-2 pl-4 text-sm">
                {/* The app name never truncates (it used to shrink to its first letter); the path gives way. */}
                <span className="flex min-w-0 flex-1 items-baseline whitespace-nowrap">
                  <span className="shrink-0">{a.label}</span>
                  <span className="min-w-0 truncate text-xs text-muted">&nbsp;· /api/v2/{a.app}/guide.md</span>
                </span>
                <a className={ghost} href={apiUrl(`${encodeURIComponent(a.app)}/guide.md`)} {...newTab}>
                  Open
                </a>
                <Button variant="ghost" size="sm" title="Copy the Markdown guide to paste into an AI agent" onClick={() => copy(a.app)}>
                  {copied === a.app ? 'Copied' : 'Copy'}
                </Button>
                <Button variant="ghost" size="sm" title="Download the guide as a .md file" onClick={() => download(a.app)}>
                  Download .md
                </Button>
              </div>
            ))}
          </div>
        ) : apps.error ? (
          <CardBody>
            <ErrorBox error={apps.error} retry={() => apps.refetch()} />
          </CardBody>
        ) : (
          <SkeletonRows rows={3} />
        )}
        <CardBody className="grid gap-3 border-t border-border">
          <div className="flex flex-wrap items-center gap-2">
            <a className={buttonClass({ size: 'sm', className: 'hover:no-underline' })} href={apiUrl('docs')} {...newTab}>
              <Icon name="book" size={14} />
              Interactive API docs
            </a>
            <a className={buttonClass({ size: 'sm', className: 'hover:no-underline' })} href={apiUrl('openapi.json')} {...newTab}>
              <Icon name="code" size={14} />
              OpenAPI schema
            </a>
          </div>
          <div className="flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-2">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">{curl}</code>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Copy example"
              title="Copy example"
              onClick={() => toast.copy(curl, 'Example copied')}
            >
              <Icon name="copy" size={14} />
            </Button>
          </div>
        </CardBody>
      </div>
    </SettingsSection>
  )
}
