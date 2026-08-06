import { LoginForm } from './login-form'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  // Next 16: searchParams is a Promise and must be awaited.
  const { next } = await searchParams

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Oat Bar CRM</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next ?? '/'} />
        </CardContent>
      </Card>
    </main>
  )
}
