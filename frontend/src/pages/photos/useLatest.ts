// The latest value of a prop or state, for listeners and callbacks that are set up once (window key handlers,
// memoized tile callbacks) and must not be re-created, or re-subscribed, on every render.
import { useRef } from 'react'

export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
