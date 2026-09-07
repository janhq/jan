import { useEffect, useState } from 'react'
import { IconCpu, IconExternalLink } from '@tabler/icons-react'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { EngineVersionInfo } from '@/services/models/types'

const UPSTREAM_REPO = 'https://github.com/ggml-org/llama.cpp'
const SHORT_SHA = 8

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  )
}

/**
 * What engine the app is running, on the provider's own settings page.
 *
 * The engine is linked into the app rather than downloaded, so there is no
 * version picker and nothing to update -- which is exactly why the version
 * needs stating somewhere: without it a user reporting a load failure has no
 * way to say which llama.cpp produced it. Renders nothing at all when the
 * version is unavailable (a build with no engine, or a failed call), since a
 * panel with blanks in it makes a weaker claim than no panel.
 */
export function LlamacppEngineInfo() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const [engine, setEngine] = useState<EngineVersionInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    serviceHub
      .models()
      .getEngineVersion()
      .then((info) => {
        if (!cancelled) setEngine(info)
      })
    return () => {
      cancelled = true
    }
  }, [serviceHub])

  if (!engine) return null

  return (
    <div className="rounded-lg border border-main-view-fg/10 bg-main-view-fg/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <IconCpu size={18} className="shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">llama.cpp</span>
          <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground">
            {engine.version}
          </span>
        </div>
        <a
          href={`${UPSTREAM_REPO}/releases/tag/${engine.tag}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <span>{t('providers:engineReleaseNotes')}</span>
          <IconExternalLink size={14} />
        </a>
      </div>
      <p className="mt-1.5 text-xs leading-normal text-muted-foreground">
        {t('providers:engineBundled')}
      </p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        <Fact label={t('providers:engineBuild')} value={engine.tag} />
        <Fact
          label={t('providers:engineCommit')}
          value={engine.commit.slice(0, SHORT_SHA)}
        />
      </dl>
    </div>
  )
}
