/**
 * Overrides the (app) layout's shell for this route only, so the printed
 * page has no sidebar even before the print stylesheet applies. The (app)
 * layout still runs above this, so the route is still authenticated.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[210mm] bg-white p-8 text-black">{children}</div>
}
