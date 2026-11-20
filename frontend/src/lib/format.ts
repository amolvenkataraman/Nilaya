// Words and numbers shown to people, in one place so every app says them the same way.

/** "1 photo", "2,345 photos" (`many` for irregular plurals). */
export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`

/** Size in KB -> "812 KB", "4.2 MB", "312 MB", "18.4 GB", "1.24 TB". */
/** precise: the classic Storage page's precision (GB with 2 decimals, MB with 1). */
export function fmtBytes(kb: number, precise = false): string {
  if (kb < 0) return '−' + fmtBytes(-kb, precise)
  if (kb >= 1024 ** 3) return `${(kb / 1024 ** 3).toFixed(2)} TB`
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(precise ? 2 : 1)} GB`
  if (precise) return `${(kb / 1024).toFixed(1)} MB`
  if (kb >= 1024) return kb < 100 * 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb / 1024)} MB`
  return `${kb} KB`
}

/** A place name as shown: "Golden Gate National Recreation Area" -> "Golden Gate NRA". Stored, linked and searched
 *  in full; only the text people read is shortened. */
export const placeText = (name: string) => name.replace(/\bNational Recreation Area\b/g, 'NRA')
