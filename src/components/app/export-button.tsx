import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * A plain anchor with `download`, so the browser handles the file itself —
 * no client JS, no blob URL. The route handler sets Content-Disposition,
 * which is what actually names the download; `download` here is the
 * accessible fallback if that header were ever missing.
 */
export function ExportButton({ entity }: { entity: 'customers' | 'orders' | 'invoices' }) {
  return (
    <Button asChild variant="outline" className="h-11">
      <a href={`/api/export/${entity}`} download>
        <Download aria-hidden />
        Export CSV
      </a>
    </Button>
  )
}
