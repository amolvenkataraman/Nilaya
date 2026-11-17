// The app-wide "g then a letter" jump (Shell) shares letters with page shortcuts (g n, g t, g s…), so page
// shortcuts ignore the key that follows a "g". Shell keeps its own pending state; this listener only notes when
// a "g" was pressed (capture phase, so it sees the key before any handler acts on it).
// Habits has an identical copy: both should become one shared helper next to Shell's g-prefix.
import { isTyping } from '../../components/ui'

let gAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) gAt = Date.now()
    },
    true,
  )
}

/** True for the key right after a "g" (within Shell's 900 ms window). */
export const afterG = (e: KeyboardEvent) => e.key !== 'g' && Date.now() - gAt < 900
