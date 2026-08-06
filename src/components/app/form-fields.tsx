'use client'

import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Every form in this app resolves with `useForm<In, unknown, Out>` because
 * the Zod schemas use `.transform()` / `.default()` / `z.coerce`, which
 * `zodResolver` can only type-check correctly with all three generics
 * supplied. That makes `control` a `Control<In, unknown, Out>`, not a bare
 * `Control<In>` (which defaults `TTransformedValues` to `In` itself and so
 * rejects a resolver whose output type differs from its input type).
 *
 * Every field component below accepts all three generics for that reason —
 * get this right once here and every later form that copies this pattern
 * just works.
 */
type BaseFieldProps<
  TIn extends FieldValues,
  TCtx,
  TOut extends FieldValues,
> = {
  control: Control<TIn, TCtx, TOut>
  name: Path<TIn>
  label: string
  description?: string
  className?: string
}

/** Coerce a Controller field value to a string an <input>/<textarea> can
 * take as `value` without React warning about switching between
 * controlled and uncontrolled. */
function toInputValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export function TextField<
  TIn extends FieldValues,
  TCtx,
  TOut extends FieldValues,
>({
  control,
  name,
  label,
  description,
  className,
  type = 'text',
  inputMode,
  autoComplete,
  placeholder,
  autoFocus,
  list,
}: BaseFieldProps<TIn, TCtx, TOut> & {
  type?: React.HTMLInputTypeAttribute
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  autoComplete?: string
  placeholder?: string
  autoFocus?: boolean
  list?: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className={className}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <FieldContent>
            <Input
              id={field.name}
              name={field.name}
              type={type}
              inputMode={inputMode}
              autoComplete={autoComplete}
              placeholder={placeholder}
              autoFocus={autoFocus}
              list={list}
              className="h-11"
              value={toInputValue(field.value)}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              ref={field.ref}
              aria-invalid={fieldState.invalid}
            />
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
          </FieldContent>
        </Field>
      )}
    />
  )
}

export function TextAreaField<
  TIn extends FieldValues,
  TCtx,
  TOut extends FieldValues,
>({
  control,
  name,
  label,
  description,
  className,
  placeholder,
  rows = 3,
}: BaseFieldProps<TIn, TCtx, TOut> & {
  placeholder?: string
  rows?: number
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className={className}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <FieldContent>
            <Textarea
              id={field.name}
              name={field.name}
              placeholder={placeholder}
              rows={rows}
              value={toInputValue(field.value)}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              ref={field.ref}
              aria-invalid={fieldState.invalid}
            />
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
          </FieldContent>
        </Field>
      )}
    />
  )
}

export type SelectOption = { value: string; label: string }

export function SelectField<
  TIn extends FieldValues,
  TCtx,
  TOut extends FieldValues,
>({
  control,
  name,
  label,
  description,
  className,
  options,
  placeholder,
}: BaseFieldProps<TIn, TCtx, TOut> & {
  options: SelectOption[]
  placeholder?: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className={className}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <FieldContent>
            <Select
              name={field.name}
              value={toInputValue(field.value)}
              onValueChange={field.onChange}
            >
              <SelectTrigger
                id={field.name}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid}
                className="h-11 w-full"
              >
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
          </FieldContent>
        </Field>
      )}
    />
  )
}

/**
 * A `role="radiogroup"` of buttons — faster to hit than a dropdown on a
 * phone. Meant for 2-6 mutually exclusive options.
 */
export function SegmentedField<
  TIn extends FieldValues,
  TCtx,
  TOut extends FieldValues,
>({
  control,
  name,
  label,
  description,
  className,
  options,
}: BaseFieldProps<TIn, TCtx, TOut> & {
  options: SelectOption[]
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className={className}>
          <FieldLabel id={`${field.name}-label`}>{label}</FieldLabel>
          <FieldContent>
            <div
              role="radiogroup"
              aria-labelledby={`${field.name}-label`}
              aria-invalid={fieldState.invalid}
              className="flex flex-wrap gap-2"
            >
              {options.map((option) => {
                const checked = toInputValue(field.value) === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => field.onChange(option.value)}
                    onBlur={field.onBlur}
                    className={cn(
                      'h-11 rounded-lg border border-input px-3 text-sm font-medium transition-colors',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-transparent hover:bg-muted',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
          </FieldContent>
        </Field>
      )}
    />
  )
}
