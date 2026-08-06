import * as z from 'zod'

/**
 * Zod 4: import is `* as z`; format helpers are top-level (z.email(), not
 * z.string().email()); customisation is the unified `error` key —
 * required_error / invalid_type_error / errorMap were removed.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email address' })),
  password: z.string().min(1, { error: 'Enter your password' }),
})

export type LoginInput = z.infer<typeof loginSchema>
