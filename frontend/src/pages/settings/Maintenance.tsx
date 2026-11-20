// Settings › Maintenance (staff): the place service's state and the maintenance jobs (GET /maintenance/jobs).
// A job runs in the background (Celery); the page polls while one runs and shows its progress, its outcome
// and, for "Name photo places", what changed or would change.
import { useState } from 'react'
import { Button, cardClass, Chip, QueryView, SettingsSection, SkeletonRows, Switch } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { shortStamp } from '../../lib/dates'
import { plural } from '../../lib/format'
import { type Maintenance, type MaintenanceJob, type MaintenanceRun, runIsBusy, useMaintenance, useStartJob } from './api'

export function MaintenancePage() {
  const q = useMaintenance()
  return (
    <>
      <SettingsSection
        page
        id="set-maintenance"
        title="Maintenance"
        description="Staff only. Jobs run in the background, so you can leave this page."
      >
        <QueryView
          query={q}
          skeleton={
            <div className={cardClass}>
              <SkeletonRows rows={4} />
            </div>
          }
        >
          {(d) => <Services d={d} />}
        </QueryView>
      </SettingsSection>
      <QueryView query={q} skeleton={null}>
        {(d) =>
          groups(d.jobs).map(([group, jobs]) => (
            <SettingsSection key={group} title={group}>
              <div className={cardClass}>
                {jobs.map((j) => (
                  <JobRow key={j.key} job={j} />
                ))}
              </div>
            </SettingsSection>
          ))
        }
      </QueryView>
    </>
  )
}

function groups(jobs: MaintenanceJob[]): [string, MaintenanceJob[]][] {
  const out = new Map<string, MaintenanceJob[]>()
  for (const j of jobs) out.set(j.group, [...(out.get(j.group) ?? []), j])
  return [...out]
}

function Services({ d }: { d: Maintenance }) {
  const pw = d.services.placewise
  const packs = (pw.data_version ?? '').split('+').filter(Boolean)
  return (
    <div className={cardClass}>
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-sm border border-border bg-surface-2 text-muted"
          aria-hidden="true"
        >
          <Icon name="pin" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            Place service (placewise)
            <Chip tone={pw.ok ? 'success' : 'danger'} size="sm">
              {pw.ok ? 'Running' : 'Not running'}
            </Chip>
          </div>
          {pw.ok ? (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                {pw.uptime_s != null && <span>Up {uptime(pw.uptime_s)}</span>}
                {pw.cache && (
                  <span title="placewise keeps no request log (lookups are coordinates); these counts show it answering">
                    {plural(pw.cache.hits + pw.cache.misses, 'lookup')} answered · {plural(pw.cache.size, 'answer')} cached
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {packs.map((p) => (
                  <Chip key={p} size="sm">
                    {p}
                  </Chip>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted">
              Photos keep their place names, but new photos aren't named and place search is off until it runs. Start it with Comptech.sh
              (window 4) or <code className="kbd">placewise --offline serve</code>. {pw.error && `(${pw.error})`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function uptime(s: number) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
  if (s < 86400) return `${Math.round(s / 3600)} h`
  return plural(Math.round(s / 86400), 'day')
}

function JobRow({ job }: { job: MaintenanceJob }) {
  const [opts, setOpts] = useState(() => Object.fromEntries(job.options.map((o) => [o.key, o.default])))
  const start = useStartJob()
  const last = job.runs[0]
  const running = runIsBusy(last)
  return (
    <div className="grid gap-2 px-4 py-3 [&+&]:border-t [&+&]:border-border">
      <div className="flex items-start gap-3 max-md:flex-wrap">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="text-sm font-semibold">{job.title}</div>
          <p className="text-xs text-muted">{job.description}</p>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={running || start.isPending}
          onClick={() => start.mutate({ key: job.key, options: opts })}
        >
          <Icon name="play" size={14} />
          {running ? 'Running…' : 'Run'}
        </Button>
      </div>
      {job.options.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {job.options.map((o) => (
            <Switch
              key={o.key}
              checked={!!opts[o.key]}
              onChange={(v) => setOpts({ ...opts, [o.key]: v })}
              label={o.label}
              disabled={running}
            />
          ))}
        </div>
      )}
      {last ? <RunLine run={last} /> : <p className="text-xs text-muted">Never run.</p>}
      {job.runs.length > 1 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Earlier runs</summary>
          <ul className="mt-1 grid gap-1">
            {job.runs.slice(1).map((r) => (
              <li key={r.id}>
                {shortStamp(r.created_on)} · {r.status} · {r.summary || '—'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

const QUEUED_TOO_LONG_MS = 30_000

const TONE = { queued: 'neutral', running: 'accent', done: 'success', failed: 'danger' } as const
const STATUS = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed' } as const

function RunLine({ run }: { run: MaintenanceRun }) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : null
  const changes = run.result.changes ?? []
  return (
    <div className="grid gap-1.5 rounded-sm bg-surface-2 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone={TONE[run.status]} size="sm">
          {STATUS[run.status]}
        </Chip>
        {run.options.preview && <Chip size="sm">Preview</Chip>}
        <span className="min-w-0 flex-1">
          {run.summary || (run.status === 'running' && run.total ? `${run.done.toLocaleString()} of ${run.total.toLocaleString()}` : '')}
        </span>
        <span className="text-muted">
          {run.started_by ? `${run.started_by} · ` : ''}
          {shortStamp(run.created_on)}
        </span>
      </div>
      {run.status === 'queued' && Date.now() - Date.parse(run.created_on) > QUEUED_TOO_LONG_MS && (
        <p className="text-warning">
          Still waiting for the background worker. Is the Celery worker running (Comptech.sh window 2) with the current code? Its log shows
          each run as it starts.
        </p>
      )}
      {runIsBusy(run) && pct !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {changes.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-muted">
            {run.options.preview ? 'What would change' : 'What changed'} (most common first)
          </summary>
          <table className="mt-1.5 w-full border-collapse">
            <tbody>
              {changes.map(([from, to, n]) => (
                <tr key={`${from}|${to}`} className="border-t border-border align-top">
                  <td className="py-1 pr-2 text-muted">{from}</td>
                  <td className="py-1 pr-2">{to}</td>
                  <td className="py-1 text-right tabular-nums">{n.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!!run.result.more_kinds && <p className="mt-1 text-muted">and {plural(run.result.more_kinds, 'more kind')} of change</p>}
        </details>
      )}
      {run.log && (
        <details>
          <summary className="cursor-pointer select-none text-muted">Output</summary>
          <pre className="mt-1 max-h-60 overflow-auto font-mono text-2xs whitespace-pre-wrap">{run.log}</pre>
        </details>
      )}
    </div>
  )
}
