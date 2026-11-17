// Small shared pieces for the Photos pages.
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'

export function PageHead({ title, sub, children, back }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; back?: string }) {
  return (
    <div className="page-head ph-head">
      {back && (
        <Link to={back} className="btn ghost icon" aria-label="Back" title="Back">
          <Icon name="chevronLeft" size={18} />
        </Link>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <h1 className="truncate">{title}</h1>
        {sub && <p className="sub tabular">{sub}</p>}
      </div>
      {children}
    </div>
  )
}
