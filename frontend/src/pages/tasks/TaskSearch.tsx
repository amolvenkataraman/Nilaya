// The top bar's task search. It keeps its own text, so typing re-renders only this field; the list updates
// once, 300 ms after the last keystroke, through the URL. Enter or Down moves the keyboard cursor to the
// first row; Escape clears, then leaves the field.
import { memo, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, SearchBox } from '../../components/ui'

export const TaskSearch = memo(function TaskSearch({
  value,
  onCommit,
  onEnter,
}: {
  value: string
  onCommit: (q: string) => void
  onEnter: () => void
}) {
  const [q, setQ] = useState(value)
  const [shown, setShown] = useState(value)
  // The URL changed elsewhere (another list, Clear all filters): show its search.
  if (shown !== value) {
    setShown(value)
    setQ(value)
  }
  useEffect(() => {
    const t = setTimeout(() => q !== value && onCommit(q), 300)
    return () => clearTimeout(t)
  }, [q, value, onCommit])
  return (
    <div className="relative w-[min(18rem,100%)] max-md:w-full [&_input::-webkit-search-cancel-button]:appearance-none">
      <SearchBox
        // `tasks-search` is the hook the "/" shortcut focuses.
        className="tasks-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search tasks"
        aria-label="Search tasks"
        kbd={q ? undefined : '/'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (q) setQ('')
            else e.currentTarget.blur()
          }
          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault()
            e.currentTarget.blur()
            onEnter()
          }
        }}
      />
      {q && (
        <Button variant="ghost" size="sm" icon className="absolute top-0.5 right-0.5" onClick={() => setQ('')} aria-label="Clear search">
          <Icon name="x" size={12} />
        </Button>
      )}
    </div>
  )
})
