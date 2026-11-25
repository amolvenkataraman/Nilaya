// The right-hand side of Contacts (a person, the overview, duplicates): one scrolling column, narrower on phones.
import { cn } from '../../lib/cn'

/** `wide`: on big screens the pane grows (a contact's details and history sit side by side). */
export const detailPane = (gap: 'gap-4' | 'gap-5' = 'gap-4', wide = false) =>
  cn(
    'grid w-full max-w-3xl content-start overflow-y-auto px-8 pt-3 pb-10 max-md:px-4 max-md:pt-2 max-md:pb-8',
    gap,
    wide && 'min-[1800px]:max-w-[112rem]',
  )
