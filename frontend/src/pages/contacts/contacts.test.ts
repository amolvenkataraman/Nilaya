import { describe, expect, it } from 'vitest'
import type { PersonBrief } from './api'
import { letterGroups } from './contactGroups'
import { formToPersonIn, initialForm } from './personFormState'

describe('contacts', () => {
  it('groups the list by first letter, with # for names that start with anything else', () => {
    const p = (name: string) => ({ name }) as PersonBrief
    const groups = letterGroups([p('anna'), p('Ali'), p('Émile'), p('9 Lives'), p('Bo')], false)
    expect(groups.map((g) => [g.letter, g.items.length])).toEqual([
      ['A', 2],
      ['#', 2],
      ['B', 1],
    ])
  })

  it('turns the form into a trimmed request without empty rows, and refuses an incomplete birthday', () => {
    const f = initialForm(null)
    f.first_name = ' Ada '
    f.phones[0].value = '  '
    f.emails[0].value = ' ada@example.com '
    f.profiles = [{ network: 'github', handle: ' ada ', _k: 1 }]
    expect(formToPersonIn(f, '', (k) => k)).toMatchObject({
      body: {
        first_name: 'Ada',
        emails: [{ label: 'home', value: 'ada@example.com' }],
        phones: [],
        profiles: { github: 'ada' },
        birthday: '',
      },
    })
    expect('username' in (formToPersonIn(f, '', (k) => k) as { body: object }).body).toBe(false)
    f.bDay = '12'
    expect(formToPersonIn(f, '', (k) => k)).toEqual({ error: 'Birthday needs a month and a valid day (the year is optional).' })
  })
})
