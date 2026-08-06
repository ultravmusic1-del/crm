import { describe, expect, it } from 'vitest'
import { interactionSchema, followUpOffsetToDate } from '@/lib/schemas/interactions'

const base = {
  customer_id: '11111111-1111-4111-8111-111111111111',
  channel: 'phone',
  direction: 'outbound',
  occurred_at: '2026-08-06T09:00:00.000Z',
}

describe('interactionSchema', () => {
  it('accepts a minimal interaction', () => {
    expect(interactionSchema.safeParse(base).success).toBe(true)
  })

  it('requires a channel', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring is how we omit `channel` from `rest`
    const { channel, ...rest } = base
    expect(interactionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a channel outside the enum', () => {
    expect(interactionSchema.safeParse({ ...base, channel: 'pigeon' }).success).toBe(false)
  })

  it('accepts every documented channel', () => {
    for (const c of ['email','phone','whatsapp','in_person','sample_drop','other']) {
      expect(interactionSchema.safeParse({ ...base, channel: c }).success).toBe(true)
    }
  })

  it('turns a blank contact_id into null rather than failing uuid parsing', () => {
    // The select renders "" when nobody is chosen.
    expect(interactionSchema.parse({ ...base, contact_id: '' }).contact_id).toBeNull()
  })

  it('turns a blank follow_up_on into null', () => {
    expect(interactionSchema.parse({ ...base, follow_up_on: '' }).follow_up_on).toBeNull()
  })

  it('rejects a follow-up date in the past', () => {
    const r = interactionSchema.safeParse({ ...base, follow_up_on: '2020-01-01' })
    expect(r.success).toBe(false)
  })
})

describe('followUpOffsetToDate', () => {
  const today = new Date('2026-08-06T12:00:00.000Z') // a Thursday

  it('resolves tomorrow', () => {
    expect(followUpOffsetToDate('tomorrow', today)).toBe('2026-08-07')
  })

  it('resolves in 3 days', () => {
    expect(followUpOffsetToDate('3d', today)).toBe('2026-08-09')
  })

  it('resolves next week', () => {
    expect(followUpOffsetToDate('1w', today)).toBe('2026-08-13')
  })

  it('resolves in 2 weeks', () => {
    expect(followUpOffsetToDate('2w', today)).toBe('2026-08-20')
  })
})
