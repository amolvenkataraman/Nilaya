// Import wizard: drop or pick a file -> preview (detected format, counts, per-row result, CSV column
// mapping, what to do with existing contacts) -> import. Nothing is written until "Import".
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Dialog, ErrorBox, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { importPreview, useContactMeta, useImportCommit, type ImportOptions, type ImportPreview, type PreviewRow } from './api'
import { plural } from './util'

const STATUS: Record<PreviewRow['status'], [string, string]> = { new: ['New', 'success'], update: ['Update', 'accent'], duplicate: ['Duplicate', ''] }
const ACCEPT = '.vcf,.vcard,.csv,.txt,text/vcard,text/x-vcard,text/csv'
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(b % 1048576 ? 1 : 0)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} bytes`)

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useContactMeta().data
  const commit = useImportCommit()
  const maxBytes = meta?.max_upload_bytes ?? 5 * 1048576
  const [file, setFile] = useState<File | null>(null)
  const [opts, setOpts] = useState<ImportOptions>({ format: 'auto', mapping: null, mode: 'merge' })
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [over, setOver] = useState(false)
  const [show, setShow] = useState<'' | PreviewRow['status']>('')
  const input = useRef<HTMLInputElement>(null)
  const run = useRef(0)

  useEffect(() => {
    if (open) return
    setFile(null); setPreview(null); setError(null); setShow(''); setOpts({ format: 'auto', mapping: null, mode: 'merge' })
  }, [open])

  const load = async (f: File, o: ImportOptions) => {
    const id = ++run.current
    setLoading(true)
    setError(null)
    try {
      const p = await importPreview(f, o)
      if (id !== run.current) return
      setPreview(p)
      // Keep the detected format and the suggested column mapping for the commit.
      setOpts((x) => ({ ...x, format: x.format === 'auto' ? p.format : x.format, mapping: p.format === 'csv' ? x.mapping ?? p.mapping : null }))
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
    setFile(f); setPreview(null); setShow(''); setOpts(o)
    load(f, o)
  }
  const change = (patch: Partial<ImportOptions>) => {
    const o = { ...opts, ...patch }
    setOpts(o)
    if (file) load(file, o)
  }
  const doImport = () => {
    if (!file) return
    commit.mutate({ file, opts }, {
      onSuccess: (r) => {
        onClose()
        toast.show(`Imported ${plural(r.created, 'new contact')}` + (r.updated ? `, updated ${r.updated}` : '') + (r.duplicates ? `, skipped ${r.duplicates}` : ''))
      },
    })
  }
  const n = preview ? preview.new + preview.updated : 0
  const rows = preview?.sample.filter((r) => !show || r.status === show) ?? []

  return (
    <Dialog open={open} onClose={onClose} title="Import contacts" width="48rem"
      footer={<>
        {file && <span className="muted xsmall truncate c-imp-file">{file.name} · {fmtSize(file.size)}</span>}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!preview || !n || loading || commit.isPending} onClick={doImport}>
          {commit.isPending ? 'Importing…' : !preview ? 'Import' : n ? `Import ${plural(n, 'contact')}` : 'Nothing to import'}
        </button>
      </>}>
      <label
        className={'c-drop' + (over ? ' over' : '') + (file ? ' small' : '')}
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
        onDragEnter={(e) => (e.preventDefault(), setOver(true))}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), choose(e.dataTransfer.files[0]))}
      >
        <Icon name="arrowDown" size={file ? 16 : 22} />
        <strong>{file ? 'Choose another file' : 'Drop a file here, or browse'}</strong>
        {!file && <span className="muted xsmall">vCard (.vcf), Google Contacts CSV, Outlook CSV, LinkedIn Connections.csv or any CSV · up to {fmtSize(maxBytes)}</span>}
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
      </label>

      {error && <ErrorBox error={error} retry={file ? () => load(file, opts) : undefined} />}
      {file && !preview && loading && <SkeletonRows rows={4} />}
      {preview && (
        <div className={'c-imp' + (loading ? ' busy' : '')} aria-live="polite" aria-busy={loading}>
          <div className="c-imp-head">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="c-imp-format"><Icon name="info" size={14} />
                <select className="select c-imp-fmt" value={opts.format} onChange={(e) => change({ format: e.target.value, mapping: null })} aria-label="File format">
                  {Object.entries(meta?.import_formats ?? { [preview.format]: preview.format_label }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div className="muted xsmall">{plural(preview.total, 'contact')} in the file · matched on email, phone, GitHub, GitLab or LinkedIn</div>
            </div>
            <div className="c-imp-mode">
              <span className="muted xsmall">Existing contacts</span>
              <div className="seg" role="group" aria-label="Existing contacts">
                <button type="button" aria-pressed={opts.mode === 'merge'} onClick={() => change({ mode: 'merge' })}>Fill in blanks</button>
                <button type="button" aria-pressed={opts.mode === 'skip'} onClick={() => change({ mode: 'skip' })}>Skip</button>
              </div>
            </div>
          </div>
          <div className="c-imp-tiles">
            <Tile n={preview.new} label="New" kind="success" on={show === 'new'} onClick={() => setShow(show === 'new' ? '' : 'new')} />
            <Tile n={preview.updated} label="Updated" kind="accent" on={show === 'update'} onClick={() => setShow(show === 'update' ? '' : 'update')} />
            <Tile n={preview.duplicates} label={preview.duplicates === 1 ? 'Duplicate' : 'Duplicates'} kind="" on={show === 'duplicate'} onClick={() => setShow(show === 'duplicate' ? '' : 'duplicate')} />
          </div>
          {preview.format === 'csv' && preview.columns.length > 0 && (
            <details className="c-map" open>
              <summary>Columns <span className="muted">· choose the field for each column</span></summary>
              <div className="c-map-grid">
                {preview.columns.map((c) => (
                  <div key={c} className="c-map-row">
                    <span className="c-map-col truncate" title={c}>{c}</span>
                    <Icon name="arrowRight" size={12} className="muted" />
                    <select className="select" value={opts.mapping?.[c] ?? ''} aria-label={`Field for column ${c}`}
                      onChange={(e) => change({ mapping: { ...(opts.mapping ?? preview.mapping), [c]: e.target.value } })}>
                      {Object.entries(preview.fields).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="c-imp-table-wrap">
            <table className="c-imp-table">
              <thead><tr><th>Name</th><th className="c-hide-phone">Details</th><th>Result</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><div className="truncate">{r.name || <span className="muted">No name</span>}</div><div className="muted xsmall truncate c-show-phone">{r.detail}</div></td>
                    <td className="muted c-hide-phone"><div className="truncate">{r.detail}</div></td>
                    <td><span className={'chip ' + STATUS[r.status][1]}>{STATUS[r.status][0]}</span>{r.match && r.status !== 'new' && <div className="muted xsmall truncate" title={r.match}>{r.status === 'update' ? 'Into ' : 'Matches '}{r.match}</div>}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={3} className="muted">Nothing to show.</td></tr>}
              </tbody>
            </table>
          </div>
          {preview.sample.length < preview.total && <p className="muted xsmall">Showing the first {preview.sample.length} of {preview.total}.</p>}
        </div>
      )}
    </Dialog>
  )
}

function Tile({ n, label, kind, on, onClick }: { n: number; label: string; kind: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={'c-imp-tile ' + kind + (on ? ' on' : '')} aria-pressed={on} onClick={onClick} title={on ? 'Show all rows' : `Show only ${label.toLowerCase()}`}>
      <strong className="tabular">{n.toLocaleString()}</strong><span>{label}</span>
    </button>
  )
}
