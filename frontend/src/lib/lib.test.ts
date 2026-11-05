import { describe, expect, it, vi, afterEach } from 'vitest'
import { api, apiUrl, ApiError, errorMessage, readCookie, safeHref, appRoute } from './api'
import { groupByDue, groupByDay, monthGrid, dueLabel, fromLocalInput, toLocalInput } from './dates'
import { parseTaskState, serializeTaskState, nextTaskState } from './qs'
import { justify } from './justify'
import { previewQuick } from './quick'
import { contrast, readable, inkOn, SURFACE } from './colour'

const U = '462e4def-457f-4e97-9482-7eeaa1fdfd71'

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds URLs, skipping empty params, and refuses absolute URLs', () => {
    expect(apiUrl('tasks/', { view: 'today', q: '', project: null, limit: 5 })).toBe('/api/v2/tasks/?view=today&limit=5')
    expect(() => apiUrl('https://evil.example/x')).toThrow()
    expect(() => apiUrl('//evil.example/x')).toThrow()
  })

  it('reads the csrftoken cookie', () => {
    expect(readCookie('csrftoken', 'a=1; csrftoken=abc%3D; b=2')).toBe('abc=')
    expect(readCookie('csrftoken', 'xcsrftoken=no')).toBe('')
  })

  it('sends CSRF + JSON on unsafe methods and surfaces API errors', async () => {
    vi.stubGlobal('document', { cookie: 'csrftoken=tok' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Nope' }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api('tasks/', { method: 'POST', body: { title: 'x' } })).rejects.toEqual(new ApiError(400, 'Nope'))
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-CSRFToken']).toBe('tok')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBe('{"title":"x"}')
  })

  it('redirects to login on 401', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { pathname: '/app/tasks', search: '?view=done', assign } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(api('me')).rejects.toBeInstanceOf(ApiError)
    expect(assign).toHaveBeenCalledWith('/accounts/login/?next=%2Fapp%2Ftasks%3Fview%3Ddone')
  })

  it('formats validation errors', () => {
    expect(errorMessage(422, { detail: [{ loc: ['body', 'payload', 'name'], msg: 'Field required' }] })).toBe('name: Field required')
  })

  it('only links same-site paths and http(s) URLs', () => {
    expect(safeHref('/tasks/?task=1')).toBe('/tasks/?task=1')
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('//evil.example')).toBeNull()
    expect(safeHref('/\\evil.example')).toBeNull()
    expect(appRoute('/tasks/?task=abc')).toBe('/tasks?task=abc')
    expect(appRoute('/accounts/profile/')).toBeNull()
  })
})

describe('dates', () => {
  const now = new Date(2026, 10, 4, 15, 0) // Wed Nov 4 2026, 3 PM local

  it('groups tasks by due date', () => {
    const items = [
      { id: 'a', due: new Date(2026, 10, 3, 9).toISOString() }, // yesterday -> overdue
      { id: 'b', due: new Date(2026, 10, 4, 23, 59).toISOString() }, // today (date-only)
      { id: 'c', due: new Date(2026, 10, 4, 9).toISOString() }, // earlier today -> overdue
      { id: 'd', due: new Date(2026, 10, 5, 10).toISOString() }, // tomorrow
      { id: 'e', due: new Date(2026, 10, 7, 10).toISOString() }, // Saturday
      { id: 'f', due: new Date(2026, 11, 1).toISOString() }, // later
      { id: 'g', due: null },
    ]
    const groups = groupByDue(items, (t) => t.due, now)
    expect(groups.map((g) => [g.key, g.items.map((t) => t.id).join('')])).toEqual([
      ['overdue', 'ac'], ['today', 'b'], ['tomorrow', 'd'], ['day:2026-11-07', 'e'], ['later', 'f'], ['nodate', 'g'],
    ])
    expect(groups[3].label).toMatch(/Sat/)
  })

  it('groups photos by day and builds Monday-first month grids', () => {
    const days = groupByDay([{ d: '2026-08-01T15:00:00' }, { d: '2026-08-01T09:00:00' }, { d: '2026-07-30T10:00:00' }], (x) => x.d)
    expect(days.map((g) => [g.key, g.items.length])).toEqual([['2026-08-01', 2], ['2026-07-30', 1]])
    const grid = monthGrid(new Date(2026, 10, 15))
    expect(grid).toHaveLength(6)
    expect(grid[0][0].getDay()).toBe(1)
    expect(grid[0][6].getDate()).toBe(1) // Nov 1 2026 is a Sunday
  })

  it('labels due dates and round-trips datetime-local', () => {
    expect(dueLabel(new Date(2026, 10, 4, 23, 59).toISOString(), now)).toBe('Today')
    expect(dueLabel(new Date(2026, 10, 5, 23, 59).toISOString(), now)).toBe('Tomorrow')
    const iso = fromLocalInput('2026-11-04T09:30')!
    expect(toLocalInput(iso)).toBe('2026-11-04T09:30')
    expect(fromLocalInput('')).toBeNull()
  })
})

describe('task query-string state', () => {
  it('parses with defaults and rejects junk', () => {
    expect(parseTaskState('')).toMatchObject({ view: 'today', project: null, layout: 'list', sort: 'due', task: null })
    expect(parseTaskState('?view=nope&task=../x&layout=board')).toMatchObject({ view: 'today', task: null, layout: 'list' })
    expect(parseTaskState(`?project=${U}&layout=board`)).toMatchObject({ view: null, project: U, layout: 'board', sort: 'position' })
  })

  it('round-trips and switches lists cleanly', () => {
    const s = parseTaskState(`?project=${U}&layout=board&q=rent&task=${U}`)
    expect(parseTaskState(serializeTaskState(s))).toEqual(s)
    const next = nextTaskState(s, { view: 'upcoming' })
    expect(serializeTaskState(next)).toBe(`?view=upcoming&task=${U}`)
    expect(serializeTaskState(nextTaskState(next, { view: 'today', task: null }))).toBe('')
  })
})

describe('justified rows', () => {
  it('fills full rows exactly and leaves the last row at target height', () => {
    const rows = justify([1.5, 1, 0.75, 1.33, 1, 1, 2], 1000, 200, 4)
    for (const row of rows.slice(0, -1)) {
      const w = row.boxes.reduce((s, b) => s + b.width, 0) + 4 * (row.boxes.length - 1)
      expect(w).toBe(1000)
      expect(row.height).toBeLessThanOrEqual(200)
    }
    expect(rows.at(-1)!.height).toBeLessThanOrEqual(200)
    expect(rows.flatMap((r) => r.boxes.map((b) => b.index))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('quick add preview', () => {
  it('spots labels, project, priority, date and repeat', () => {
    expect(previewQuick('Pay rent tomorrow 5pm *bills +Home !3 every month')).toEqual({
      title: 'Pay rent', labels: ['bills'], project: 'Home', priority: 3, when: 'tomorrow 5pm', repeat: 'every month',
    })
    expect(previewQuick('Call mom').title).toBe('Call mom')
  })
})

describe('contrast-aware colours', () => {
  it('keeps colours that stand out and fixes ones that do not', () => {
    expect(readable('#3b82f6', SURFACE.light)).toBe('#3b82f6')
    const pale = readable('#ffff99', SURFACE.light)
    expect(contrast(pale, SURFACE.light)).toBeGreaterThanOrEqual(3)
    const dim = readable('#1a1a40', SURFACE.dark)
    expect(contrast(dim, SURFACE.dark)).toBeGreaterThanOrEqual(3)
    expect(readable('nope', SURFACE.light)).toBe('#64748b')
    expect(inkOn('#ffff99')).toBe('#111827')
    expect(inkOn('#1e3a8a')).toBe('#ffffff')
  })
})

describe('favicon', () => {
  it('serialises an app glyph onto its colour tile, once per app', async () => {
    const { faviconSvg, faviconUrl } = await import('./favicon')
    const svg = faviconSvg('calendar', '#0891b2')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8.5" fill="#0891b2"\/>/)
    expect(svg).toContain('<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"></rect><path d="M3 9.5h18M8 3v3M16 3v3"></path>')
    expect(faviconSvg('apps', '#000')).toContain('fill="currentColor" stroke="none"')
    expect(faviconUrl('calendar', '#0891b2')).toBe('data:image/svg+xml,' + encodeURIComponent(svg))
  })
})
