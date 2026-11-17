// Typed `meta` for queries and mutations (TanStack Query's Register interface).
import '@tanstack/react-query'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** The toast text for a failure (default: the error's message); null shows nothing. */
      errorMessage?: (error: unknown, variables: unknown) => string | null
    }
  }
}
