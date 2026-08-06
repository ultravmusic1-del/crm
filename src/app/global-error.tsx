'use client'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', padding: '2rem' }}>
        <h1>Something went wrong</h1>
        <p>Reload the page. Reference: {error.digest ?? 'none'}</p>
      </body>
    </html>
  )
}
