// The card that sign-in and "request access" share: a mark, a title and a line under it, then the body.
import type { ReactNode } from 'react'
import { BrandMark } from './PublicFrame'
import type { IconName } from '../../components/Icon'

export function AuthCard({ icon, title, sub, children }: { icon: IconName; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="mx-auto mt-12 grid w-full max-w-[24rem] min-w-0 gap-5 rounded-md border border-border bg-surface px-8 pt-8 pb-6 shadow-[var(--app-shadow)] max-sm:mt-4 max-sm:px-5 max-sm:pt-6 max-sm:pb-5 max-sm:shadow-none">
      <div className="grid justify-items-center gap-1.5 text-center">
        <BrandMark icon={icon} size="lg" iconSize={22} />
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.015em]">{title}</h1>
        <p className="text-sm text-muted">{sub}</p>
      </div>
      {children}
    </section>
  )
}

/** The full-width, taller primary button of these cards. `!` because the button's size sets height and text. */
export const authSubmit = 'h-10! w-full text-base!'
