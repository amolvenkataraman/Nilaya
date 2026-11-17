// The Habits page column: centred, narrow for Today and a habit, wide for the progress grid.
import { cn } from '../../lib/cn'

export const habitPage = (wide = false) =>
  cn('mx-auto grid content-start gap-3.5 px-6 pt-5 pb-12 max-md:px-3 max-md:pt-3.5 max-md:pb-8', wide ? 'max-w-[80rem]' : 'max-w-[52rem]')
