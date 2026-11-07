// Whether this page was served to a signed-in browser. The server (Comptech/spa.py) writes
// <meta name="nilaya-session" content="1|0"> into index.html, so routes are chosen before any request.
// Only a hint for the first render: the API still decides (a 401 sends the browser to /login).
// Without the tag (the Vite dev server serves index.html itself) assume signed in.

export function signedIn(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  const tag = doc?.querySelector('meta[name="nilaya-session"]')
  return tag ? tag.getAttribute('content') === '1' : true
}
