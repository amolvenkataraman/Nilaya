// The people list in runs that share a heading: the first letter of the name (A, B, … and # for anything
// else), or one "Due" run for the reach-out list, which is ordered by due date instead of name.
import type { PersonBrief } from './api'

export interface LetterGroup {
  letter: string
  items: PersonBrief[]
}

export function letterGroups(people: readonly PersonBrief[], byDue: boolean): LetterGroup[] {
  const out: LetterGroup[] = []
  for (const p of people) {
    const letter = byDue
      ? 'Due'
      : (p.name || '#')
          .slice(0, 1)
          .toUpperCase()
          .replace(/[^A-Z]/, '#')
    const last = out.at(-1)
    if (last?.letter === letter) last.items.push(p)
    else out.push({ letter, items: [p] })
  }
  return out
}
