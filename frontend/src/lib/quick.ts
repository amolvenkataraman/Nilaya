// Client-side preview of what POST /tasks/quick will understand, so the quick-add box can show
// chips while typing and an optimistic row can show a clean title. The server stays the source
// of truth for the real parse (dates, repeats); this only spots the tokens.

export interface QuickPreview {
  title: string
  labels: string[]
  project: string | null
  priority: number | null // 1..5 as typed
  when: string | null // the date/time words found, verbatim
  repeat: string | null
}

const WORD = String.raw`(?:"([^"]+)"|([\p{L}\p{N}_\-]+))`
const DATE_WORDS = String.raw`\b(?:(?:on|by|due)\s+)?(today|tonight|tomorrow|tmrw|next\s+(?:week|month|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|in\s+\d+\s+(?:days?|weeks?|months?)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{4}-\d{2}-\d{2})\b`
const TIME_WORDS = String.raw`\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|noon|midnight)\b`
const REPEAT = String.raw`\b(every\s+(?:\d+\s+)?(?:min(?:ute)?s?|hours?|days?|weeks?|months?|years?)|daily|weekly|monthly|yearly)\b`

export function previewQuick(text: string): QuickPreview {
  let rest = ` ${text} `
  const out: QuickPreview = { title: '', labels: [], project: null, priority: null, when: null, repeat: null }
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(rest)
    if (!m) return false
    fn(m)
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)
    return true
  }
  while (take(new RegExp(String.raw`(?:^|\s)\*` + WORD, 'u'), (m) => out.labels.push(m[1] ?? m[2]))) { /* all labels */ }
  take(new RegExp(String.raw`(?:^|\s)\+` + WORD, 'u'), (m) => (out.project = m[1] ?? m[2]))
  take(/(?:^|\s)!([1-5])\b/, (m) => (out.priority = Number(m[1])))
  take(new RegExp(REPEAT, 'i'), (m) => (out.repeat = m[1]))
  const when: string[] = []
  take(new RegExp(DATE_WORDS, 'i'), (m) => when.push(m[1]))
  take(new RegExp(TIME_WORDS, 'i'), (m) => when.push(m[1]))
  out.when = when.length ? when.join(' ') : null
  out.title = rest.replace(/\s+/g, ' ').trim()
  return out
}
