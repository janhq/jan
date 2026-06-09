/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from '@tanstack/react-router'
import { FlaskConical } from 'lucide-react'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { WorkspacePanelsLayout } from '@/containers/ModelToolsPanel'
import { StudioPlayground } from '@/containers/StudioPlayground'
import { route } from '@/constants/routes'
import { cn } from '@/lib/utils'

export const Route = createFileRoute(route.settings.studio as any)({
  component: StudioSettings,
})

const quickLinks = [
  {
    title: 'Model providers',
    description: 'Configure vLLM, Ollama, cloud APIs, and local engines.',
    to: route.settings.model_providers,
  },
  {
    title: 'Local API server',
    description: 'Expose Jan models to external tools on localhost.',
    to: route.settings.local_api_server,
  },
  {
    title: 'MCP servers',
    description: 'Wire agent tools into chat and the local API proxy.',
    to: route.settings.mcp_servers,
  },
  {
    title: 'Hardware',
    description: 'Inspect GPU backends and device allocation.',
    to: route.settings.hardware,
  },
]

function StudioSettings() {
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden">
      <HeaderPage>
        <div className="flex w-full items-center justify-between gap-3 pr-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" />
            <span className="font-studio text-base font-medium">Studio</span>
          </div>
        </div>
      </HeaderPage>

      <WorkspacePanelsLayout
        className="flex-1"
        scope={{ id: 'studio', type: 'workspace', label: 'Studio' }}
      >
        <div className="flex h-full min-h-0">
          <SettingsMenu />
          <main className="min-w-0 flex-1 overflow-y-auto p-4 pt-0">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
              <section className="rounded-lg border border-border/60 bg-card p-4">
                <h1 className="font-studio text-base font-medium text-foreground">
                  Developer environment
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Studio is for experimenting: playground requests, default
                  sampler presets, and quick access to the rest of your dev
                  stack. Runtime engines like vLLM and Ollama live under
                  Settings → Model Providers, where you can configure endpoints,
                  start processes, and manage models.
                </p>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                {quickLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={cn(
                      'rounded-lg border border-border/60 bg-card p-4 transition-colors',
                      'hover:bg-foreground/5'
                    )}
                  >
                    <h2 className="text-sm font-medium text-foreground">
                      {link.title}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {link.description}
                    </p>
                  </Link>
                ))}
              </section>

              <StudioPlayground />
            </div>
          </main>
        </div>
      </WorkspacePanelsLayout>
    </div>
  )
}
