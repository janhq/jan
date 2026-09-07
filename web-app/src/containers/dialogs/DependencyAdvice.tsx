import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { getInstallRecommendations } from '@/lib/backendDependencies'

/**
 * Turns missing library names into install advice. Shared by the standalone
 * dialog and the first-run wizard, which reports the same failure inline rather
 * than stacking a modal on top of itself.
 */
export function DependencyAdvice({
  backend,
  missingLibraries,
}: {
  backend: string
  missingLibraries: string[]
}) {
  const { t } = useTranslation()
  const [showRawLibs, setShowRawLibs] = useState(false)
  const { recommendations, uncovered } = getInstallRecommendations(
    missingLibraries,
    backend
  )

  return (
    <div className="space-y-3" data-testid="dependency-advice">
      {recommendations.length > 0 ? (
        <>
          <p className="text-sm text-main-view-fg/60">
            {t('common:missingDependenciesDialog.installLabel')}
          </p>
          <ul className="space-y-2">
            {recommendations.map((rec) => (
              <li
                key={rec.label}
                className="rounded-lg border border-main-view-fg/10 bg-main-view-fg/2 p-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-main-view-fg">
                    {rec.label}
                  </span>
                  {rec.url && (
                    <a
                      href={rec.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 shrink-0"
                    >
                      {t('common:missingDependenciesDialog.download')}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-main-view-fg/60 leading-relaxed">
                  {rec.description}
                </p>
              </li>
            ))}
          </ul>

          {uncovered.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-main-view-fg/50">
                {t('common:missingDependenciesDialog.additionalLibraries')}
              </p>
              <ul className="space-y-1">
                {uncovered.map((lib) => (
                  <li
                    key={lib}
                    className="text-xs font-mono text-main-view-fg/70 bg-main-view-fg/5 px-2 py-1 rounded border border-main-view-fg/5 break-all"
                  >
                    {lib}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        // No known group -- fall back to the raw list.
        <div className="space-y-1">
          <p className="text-sm text-main-view-fg/60">
            {t('common:missingDependenciesDialog.missingLibraries')}
          </p>
          <ul className="max-h-[180px] overflow-y-auto space-y-1">
            {missingLibraries.map((lib) => (
              <li
                key={lib}
                className="text-sm font-mono text-main-view-fg/80 bg-main-view-fg/10 px-2 py-1 rounded border border-main-view-fg/5 break-all"
              >
                {lib}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommendations.length > 0 && missingLibraries.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowRawLibs((v) => !v)}
            className="flex items-center gap-1 text-xs text-main-view-fg/40 hover:text-main-view-fg/60 transition-colors"
          >
            {showRawLibs ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            {t('common:missingDependenciesDialog.showRawLibraries', {
              count: missingLibraries.length,
            })}
          </button>
          {showRawLibs && (
            <ul className="mt-2 max-h-[120px] overflow-y-auto space-y-1">
              {missingLibraries.map((lib) => (
                <li
                  key={lib}
                  className="text-xs font-mono text-main-view-fg/50 bg-main-view-fg/5 px-2 py-0.5 rounded break-all"
                >
                  {lib}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
