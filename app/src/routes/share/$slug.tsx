import { createFileRoute, useParams } from '@tanstack/react-router'
import { SidebarProvider } from '@/components/ui/sidebar'
import { SharePageContent } from '@/components/share/share-page-content'

function SharePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined

  if (!slug) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Invalid share link</p>
      </div>
    )
  }

  return (
    <SidebarProvider>
      <SharePageContent slug={slug} />
    </SidebarProvider>
  )
}

export const Route = createFileRoute('/share/$slug')({
  component: SharePage,
})
