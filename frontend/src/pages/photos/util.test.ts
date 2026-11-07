import { describe, expect, it } from 'vitest'
import { fmtBytes, fmtHms } from './util'

describe('storage formats', () => {
  it('shows terabytes and long durations without truncating', () => {
    expect(fmtBytes(2.5 * 1024 ** 3)).toBe('2.50 TB')
    expect(fmtBytes(270 * 1024 ** 2)).toBe('270.0 GB')
    expect(fmtHms(123 * 3600 + 4 * 60 + 5)).toBe('123:04:05')
    expect(fmtHms(65)).toBe('0:01:05')
  })
})
