// The contact form's state and how it becomes a request: every field the API stores, repeatable rows with a
// stable key each (so React keeps focus while rows are added and removed), and the checks that run before
// saving. Pure, so the conversion is tested without rendering the form.
import type { Address, PersonDetail, PersonIn } from './api'
import { buildBirthday, parseBirthday } from './personFields'

export type Row<T> = T & { _k: number }

let seq = 0
/** A key no other row has, for a row added in the form. */
export const newRowKey = () => ++seq
const rows = <T>(list: T[] | undefined): Row<T>[] => (list ?? []).map((x) => ({ ...x, _k: newRowKey() }))

export const blankAddress = (): Address => ({ label: '', street: '', city: '', region: '', postcode: '', country: '' })

export interface FormState {
  prefix: string
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  nickname: string
  display_name: string
  company: string
  title: string
  department: string
  emails: Row<{ label: string; value: string }>[]
  phones: Row<{ label: string; value: string }>[]
  addresses: Row<Address>[]
  profiles: Row<{ network: string; handle: string }>[]
  links: Row<{ label: string; url: string }>[]
  custom_fields: Row<{ key: string; value: string }>[]
  bYear: string
  bMonth: string
  bDay: string
  anniversary: string
  tags: string[]
  groups: string[]
  kit: number
  favorite: boolean
  username: string
  how_met: string
  notes: string
}

/** The form's content without row keys, for the unsaved-changes check. */
export const snapshot = (f: FormState) => JSON.stringify(f, (k, v) => (k === '_k' ? undefined : v))

export function initialForm(p: PersonDetail | null): FormState {
  const b = parseBirthday(p?.birthday)
  return {
    prefix: p?.prefix ?? '',
    first_name: p?.first_name ?? '',
    middle_name: p?.middle_name ?? '',
    last_name: p?.last_name ?? '',
    suffix: p?.suffix ?? '',
    nickname: p?.nickname ?? '',
    display_name: p?.display_name ?? '',
    company: p?.company ?? '',
    title: p?.title ?? '',
    department: p?.department ?? '',
    emails: rows(p ? p.emails : [{ label: 'home', value: '' }]),
    phones: rows(p ? p.phones : [{ label: 'mobile', value: '' }]),
    addresses: rows(p?.addresses),
    links: rows(p?.links),
    custom_fields: rows(p?.custom_fields),
    profiles: rows(Object.entries(p?.profiles ?? {}).map(([network, handle]) => ({ network, handle }))),
    bYear: b?.year ?? '',
    bMonth: b?.month ?? '',
    bDay: b?.day ?? '',
    anniversary: p?.anniversary ?? '',
    tags: p?.tags ?? [],
    groups: p?.groups ?? [],
    kit: p?.keep_in_touch_days ?? 0,
    favorite: p?.favorite ?? false,
    username: p?.linked_user?.username ?? '',
    how_met: p?.how_met ?? '',
    notes: p?.notes ?? '',
  }
}

/**
 * The request body for the form (trimmed, empty rows dropped), or the message to show instead.
 * Everything the form shows is sent; the linked account only when it changed (blank unlinks).
 */
export function formToPersonIn(
  f: FormState,
  linkedUsername: string,
  networkLabel: (key: string) => string,
): { body: PersonIn } | { error: string } {
  const t = (s: string) => s.trim()
  const strip = <T extends { _k: number }>(list: T[]) => list.map(({ _k, ...rest }) => rest)
  const birthday = buildBirthday(t(f.bYear), f.bMonth, t(f.bDay))
  if (birthday === null) return { error: 'Birthday needs a month and a valid day (the year is optional).' }
  const emails = strip(f.emails)
    .map((e) => ({ label: t(e.label), value: t(e.value) }))
    .filter((e) => e.value)
  const phones = strip(f.phones)
    .map((e) => ({ label: t(e.label), value: t(e.value) }))
    .filter((e) => e.value)
  const profiles: Record<string, string> = {}
  for (const r of f.profiles) {
    if (!t(r.handle)) continue
    if (profiles[r.network]) return { error: `Only one ${networkLabel(r.network)} profile per contact.` }
    profiles[r.network] = t(r.handle)
  }
  const body: PersonIn = {
    prefix: t(f.prefix),
    first_name: t(f.first_name),
    middle_name: t(f.middle_name),
    last_name: t(f.last_name),
    suffix: t(f.suffix),
    nickname: t(f.nickname),
    display_name: t(f.display_name),
    company: t(f.company),
    title: t(f.title),
    department: t(f.department),
    emails,
    phones,
    addresses: strip(f.addresses)
      .map((a) => ({
        label: t(a.label),
        street: t(a.street),
        city: t(a.city),
        region: t(a.region),
        postcode: t(a.postcode),
        country: t(a.country),
      }))
      .filter((a) => a.street || a.city || a.region || a.postcode || a.country),
    profiles,
    links: strip(f.links)
      .map((l) => ({ label: t(l.label), url: t(l.url) }))
      .filter((l) => l.url),
    custom_fields: strip(f.custom_fields)
      .map((c) => ({ key: t(c.key), value: t(c.value) }))
      .filter((c) => c.key),
    birthday,
    anniversary: f.anniversary || null,
    tags: f.tags,
    groups: f.groups,
    keep_in_touch_days: f.kit || null,
    favorite: f.favorite,
    how_met: t(f.how_met),
    notes: t(f.notes),
  }
  if (t(f.username) !== linkedUsername) body.username = t(f.username)
  if (!body.first_name && !body.last_name && !body.display_name && !body.nickname && !body.company && !emails.length && !phones.length)
    return { error: 'Give the contact a name, company, email or phone.' }
  return { body }
}
