// Import wizard: drop or pick a file -> preview (detected format, counts, per-row result, CSV column
// mapping, what to do with existing contacts) -> import. Nothing is written until "Import".
// Each opening starts over (the dialog remounts), so a closed import never leaves a file behind.
import { useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, Dialog, ErrorBox, Segmented, Select, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import { importPreview, useContactMeta, useImportCommit, type ImportOptions, type ImportPreview, type PreviewRow } from './api'
import { Chip, type ChipTone } from './Chip'
import { FileDrop } from './FileDrop'
import { useOpenCount } from './useOpenCount'

const STATUS: Record<PreviewRow['status'], [string, ChipTone]> = {
  new: ['New', 'success'],
  update: ['Update', 'accent'],
  duplicate: ['Duplicate', 'default'],
}
const ACCEPT = '.vcf,.vcard,.csv,.txt,text/vcard,text/x-vcard,text/csv'
const fmtSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(b % 1048576 ? 1 : 0)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} bytes`
const MODES = [
  { value: 'merge', label: 'Fill in blanks' },
  { value: 'skip', label: 'Skip' },
] as const

// Segmented's buttons keep the browser's border and grey fill; the class below clears them until it does.
const segmentedFix = '[&>button]:border-0 [&>button[aria-pressed=false]]:bg-transparent'

interface Props {
  open: boolean
  onClose: () => void
}

export function ImportDialog(props: Props) {
  return <ImportWizard key={useOpenCount(props.open)} {...props} />
}

function ImportWizard({ open, onClose }: Props) {
  const meta = useContactMeta().data
  const commit = useImportCommit()
  const maxBytes = meta?.max_upload_bytes ?? 5 * 1048576
  const [file, setFile] = useState<File | null>(null)
  const [opts, setOpts] = useState<ImportOptions>({ format: 'auto', mapping: null, mode: 'merge' })
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [show, setShow] = useState<'' | PreviewRow['status']>('')
  const run = useRef(0)

  const load = async (f: File, o: ImportOptions) => {
    const id = ++run.current
    setLoading(true)
    setError(null)
    try {
      const p = await importPreview(f, o)
      if (id !== run.current) return
      setPreview(p)
      // Keep the detected format and the suggested column mapping for the commit.
      setOpts((x) => ({
        ...x,
        format: x.format === 'auto' ? p.format : x.format,
        mapping: p.format === 'csv' ? (x.mapping ?? p.mapping) : null,
      }))
    } catch (e) {
      if (id === run.current) setError(e as Error)
    } finally {
      if (id === run.current) setLoading(false)
    }
  }
  const choose = (f: File | undefined) => {
    if (!f) return
    if (f.size > maxBytes) return toast.error(`Files can be up to ${fmtSize(maxBytes)}.`)
    const o: ImportOptions = { format: 'auto', mapping: null, mode: opts.mode }
    setFile(f)
    setPreview(null)
    setShow('')
    setOpts(o)
    load(f, o)
  }
  const change = (patch: Partial<ImportOptions>) => {
    const o = { ...opts, ...patch }
    setOpts(o)
    if (file) load(file, o)
  }
  const doImport = () => {
    if (!file) return
    commit.mutate(
      { file, opts },
      {
        onSuccess: (r) => {
          onClose()
          toast.show(
            `Imported ${plural(r.created, 'new contact')}` +
              (r.updated ? `, updated ${r.updated}` : '') +
              (r.duplicates ? `, skipped ${r.duplicates}` : ''),
          )
        },
      },
    )
  }
  const toggle = (s: PreviewRow['status']) => setShow(show === s ? '' : s)
  const n = preview ? preview.new + preview.updated : 0
  const rows = preview?.sample.filter((r) => !show || r.status === show) ?? []
  const cell = 'border-b border-border px-3 py-1.5'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import contacts"
      width="48rem"
      footer={
        <>
          {file && (
            <span className="max-w-1/2 truncate text-xs text-muted">
              {file.name} · {fmtSize(file.size)}
            </span>
          )}
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!preview || !n || loading || commit.isPending} onClick={doImport}>
            {commit.isPending ? 'Importing…' : !preview ? 'Import' : n ? `Import ${plural(n, 'contact')}` : 'Nothing to import'}
          </Button>
        </>
      }
    >
      <FileDrop accept={ACCEPT} onFile={choose} compact={!!file}>
        <Icon name="arrowDown" size={file ? 16 : 22} />
        <strong>{file ? 'Choose another file' : 'Drop a file here, or browse'}</strong>
        {!file && (
          <span className="text-xs text-muted">
            vCard (.vcf), Google Contacts CSV, Outlook CSV, LinkedIn Connections.csv or any CSV · up to {fmtSize(maxBytes)}
          </span>
        )}
      </FileDrop>

      {error && <ErrorBox error={error} retry={file ? () => load(file, opts) : undefined} />}
      {file && !preview && loading && <SkeletonRows rows={4} />}
      {preview && (
        <div className={cn('grid gap-3 transition-opacity', loading && 'opacity-60')} aria-live="polite" aria-busy={loading}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-auto">
              <div className="flex items-center gap-1.5 text-muted">
                <Icon name="info" size={14} />
                <Select
                  className="h-7! w-auto! font-semibold"
                  value={opts.format}
                  onChange={(e) => change({ format: e.target.value, mapping: null })}
                  aria-label="File format"
                >
                  {Object.entries(meta?.import_formats ?? { [preview.format]: preview.format_label }).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="text-xs text-muted">
                {plural(preview.total, 'contact')} in the file · matched on email, phone, GitHub, GitLab or LinkedIn
              </div>
            </div>
            <div className="grid justify-items-start gap-1">
              <span className="text-xs text-muted">Existing contacts</span>
              <Segmented
                className={segmentedFix}
                label="Existing contacts"
                value={opts.mode}
                options={MODES}
                onChange={(mode) => change({ mode })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Tile n={preview.new} label="New" tone="text-success" on={show === 'new'} onClick={() => toggle('new')} />
            <Tile n={preview.updated} label="Updated" tone="text-accent" on={show === 'update'} onClick={() => toggle('update')} />
            <Tile
              n={preview.duplicates}
              label={preview.duplicates === 1 ? 'Duplicate' : 'Duplicates'}
              tone="text-fg"
              on={show === 'duplicate'}
              onClick={() => toggle('duplicate')}
            />
          </div>
          {preview.format === 'csv' && preview.columns.length > 0 && (
            <details className="rounded-md border border-border px-3 py-2" open>
              <summary className="cursor-pointer text-sm font-medium">
                Columns <span className="text-muted">· choose the field for each column</span>
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 max-md:grid-cols-1">
                {preview.columns.map((c) => (
                  <div key={c} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 text-sm">
                    <span className="truncate font-mono text-xs" title={c}>
                      {c}
                    </span>
                    <Icon name="arrowRight" size={12} className="text-muted" />
                    <Select
                      value={opts.mapping?.[c] ?? ''}
                      aria-label={`Field for column ${c}`}
                      onChange={(e) => change({ mapping: { ...(opts.mapping ?? preview.mapping), [c]: e.target.value } })}
                    >
                      {Object.entries(preview.fields).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:bg-surface-2 [&>th]:text-left [&>th]:text-xs [&>th]:font-semibold [&>th]:text-muted">
                  <th className={cell}>Name</th>
                  <th className={cn(cell, 'max-md:hidden')}>Details</th>
                  <th className={cn(cell, 'w-2/5')}>Result</th>
                </tr>
              </thead>
              <tbody className="[&_td]:align-top [&>tr:last-child>td]:border-b-0">
                {rows.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no id and never reorder
                  <tr key={i}>
                    <td className={cell}>
                      <div className="truncate">{r.name || <span className="text-muted">No name</span>}</div>
                      <div className="hidden truncate text-xs text-muted max-md:block">{r.detail}</div>
                    </td>
                    <td className={cn(cell, 'text-muted max-md:hidden')}>
                      <div className="truncate">{r.detail}</div>
                    </td>
                    <td className={cn(cell, 'w-2/5')}>
                      <Chip tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Chip>
                      {r.match && r.status !== 'new' && (
                        <div className="truncate text-xs text-muted" title={r.match}>
                          {r.status === 'update' ? 'Into ' : 'Matches '}
                          {r.match}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={3} className={cn(cell, 'text-muted')}>
                      Nothing to show.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {preview.sample.length < preview.total && (
            <p className="text-xs text-muted">
              Showing the first {preview.sample.length} of {preview.total}.
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

function Tile({ n, label, tone, on, onClick }: { n: number; label: string; tone: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        'grid justify-items-start gap-0.5 rounded-md border bg-surface px-3 py-2.5 text-left text-xs text-muted',
        on
          ? 'border-accent shadow-[0_0_0_1px_var(--app-accent)]'
          : 'border-border hover:border-[color-mix(in_srgb,var(--app-muted)_45%,var(--app-border))]',
      )}
      aria-pressed={on}
      onClick={onClick}
      title={on ? 'Show all rows' : `Show only ${label.toLowerCase()}`}
    >
      <strong className={cn('text-lg font-semibold tabular-nums max-md:text-md', tone)}>{n.toLocaleString()}</strong>
      <span>{label}</span>
    </button>
  )
}
