import { describe, expect, it } from 'vitest'
import { loginSchema } from '@/lib/schemas/auth'

describe('loginSchema', () => {
  it('accepts a valid credential pair', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: 'hunter22' })
    expect(r.success).toBe(true)
  })

  it('rejects a malformed email with our own message', () => {
    const r = loginSchema.safeParse({ email: 'nope', password: 'hunter22' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Enter a valid email address')
  })

  it('rejects an empty password', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: '' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Enter your password')
  })

  it('lowercases and trims the email so login is case-insensitive', () => {
    const r = loginSchema.parse({ email: '  A@B.COM ', password: 'hunter22' })
    expect(r.email).toBe('a@b.com')
  })
})
