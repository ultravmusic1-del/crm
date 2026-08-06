'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TextField } from '@/components/app/form-fields'
import { updateSettings } from '@/lib/actions/settings'
import { settingsSchema, type SettingsInput, type SettingsOutput } from '@/lib/schemas/settings'
import type { AppSettings } from '@/lib/queries/settings'
import { cn } from '@/lib/utils'

function toDefaultValues(settings: AppSettings): SettingsInput {
  return {
    business_name: settings.business_name,
    business_email: settings.business_email ?? '',
    business_phone: settings.business_phone ?? '',
    address_line1: settings.address_line1 ?? '',
    address_line2: settings.address_line2 ?? '',
    city: settings.city ?? '',
    postcode: settings.postcode ?? '',
    country: settings.country ?? '',

    timezone: settings.timezone,
    currency_code: settings.currency_code,
    currency_symbol: settings.currency_symbol,
    invoice_prefix: settings.invoice_prefix,
    currency_decimals: settings.currency_decimals,
    default_payment_terms_days: settings.default_payment_terms_days,
    lapse_threshold_days: settings.lapse_threshold_days,

    bank_name: settings.bank_name ?? '',
    bank_account_name: settings.bank_account_name ?? '',
    bank_account_number: settings.bank_account_number ?? '',
    bank_iban: settings.bank_iban ?? '',
    bank_swift: settings.bank_swift ?? '',
  }
}

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty, isSubmitting },
  } = useForm<SettingsInput, unknown, SettingsOutput>({
    resolver: zodResolver(settingsSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(settings),
  })

  async function onSubmit(values: SettingsOutput) {
    const result = await updateSettings(values)
    if (result.ok) {
      toast.success('Settings saved')
      // Clears the dirty state so the save bar and "Unsaved changes"
      // indicator go away — but only on success. An error must leave the
      // form exactly as the user left it.
      reset(values)
    } else {
      toast.error(result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 pb-24 md:pb-0">
      <Card>
        <CardHeader>
          <CardTitle>Business</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextField control={control} name="business_name" label="Business name" />
          <TextField
            control={control}
            name="business_email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
          />
          <TextField
            control={control}
            name="business_phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <TextField control={control} name="address_line1" label="Address line 1" />
          <TextField control={control} name="address_line2" label="Address line 2" />
          <div className="grid grid-cols-2 gap-4">
            <TextField control={control} name="city" label="City" />
            <TextField control={control} name="postcode" label="Postcode" />
          </div>
          <TextField control={control} name="country" label="Country" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Money</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextField control={control} name="timezone" label="Timezone" />
          <div className="grid grid-cols-2 gap-4">
            <TextField control={control} name="currency_code" label="Currency code" />
            <TextField control={control} name="currency_symbol" label="Currency symbol" />
          </div>
          <TextField
            control={control}
            name="currency_decimals"
            label="Currency decimals"
            inputMode="numeric"
            className="max-w-28"
          />
          <TextField
            control={control}
            name="default_payment_terms_days"
            label="Default payment terms (days)"
            inputMode="numeric"
            className="max-w-28"
          />
          <TextField
            control={control}
            name="invoice_prefix"
            label="Invoice prefix"
            className="max-w-40"
          />
          <TextField
            control={control}
            name="lapse_threshold_days"
            label="Lapse threshold (days)"
            description="Customers with no order in this many days are flagged as lapsed."
            inputMode="numeric"
            className="max-w-28"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank details for invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextField control={control} name="bank_name" label="Bank name" />
          <TextField control={control} name="bank_account_name" label="Account name" />
          <TextField control={control} name="bank_account_number" label="Account number" />
          <TextField control={control} name="bank_iban" label="IBAN" />
          <TextField control={control} name="bank_swift" label="SWIFT / BIC" />
        </CardContent>
      </Card>

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur',
          'md:static md:inset-auto md:z-auto md:border-t-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none',
        )}
      >
        <span className="text-sm text-muted-foreground" role="status">
          {isDirty ? 'Unsaved changes' : null}
        </span>
        <Button type="submit" className="h-11" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
