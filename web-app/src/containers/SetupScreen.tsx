import { Card } from './Card'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Link, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from './HeaderPage'
import { isProd } from '@/lib/version'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform'
import { useModelSources } from '@/hooks/useModelSources'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useEffect, useMemo, useCallback, useState } from 'react'
import { Progress } from '@/components/ui/progress'

// Jan Model V2 configuration
const JAN_MODEL_V2_NAME = 'jan-v2-vl-med-gguf'
const DEFAULT_QUANTIZATION = 'q4_k_m'

// Check if Quick Start feature is available (Desktop only)
const isQuickStartAvailable = PlatformFeatures[PlatformFeature.LOCAL_INFERENCE]

function SetupScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { providers, getProviderByName } = useModelProvider()
  const firstItemRemoteProvider =
    providers.length > 0 ? providers[1]?.provider : 'openai'

  // Check if setup tour has been completed
  const isSetupCompleted =
    localStorage.getItem(localStorageKey.setupCompleted) === 'true'

  // Model sources and download state - only used on Desktop
  const { sources, fetchSources } = useModelSources()
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const serviceHub = useServiceHub()
  const { huggingfaceToken } = useGeneralSetting()
  const llamaProvider = getProviderByName('llamacpp')

  // Track if we initiated quick start download
  const [quickStartInitiated, setQuickStartInitiated] = useState(false)

  // Fetch model sources on mount (Desktop only)
  useEffect(() => {
    if (isQuickStartAvailable) {
      fetchSources()
    }
  }, [fetchSources])

  // Find Jan Model V2 in catalog (Desktop only)
  const janModelV2 = useMemo(() => {
    if (!isQuickStartAvailable) return null
    return sources.find((model) =>
      model.model_name.toLowerCase().includes(JAN_MODEL_V2_NAME)
    )
  }, [sources])

  // Find the default variant (q4_k_m)
  const defaultVariant = useMemo(() => {
    if (!janModelV2) return null
    return janModelV2.quants.find((quant) =>
      quant.model_id.toLowerCase().includes(DEFAULT_QUANTIZATION)
    )
  }, [janModelV2])

  // Check download status (Desktop only)
  const downloadProcesses = useMemo(
    () =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      })),
    [downloads]
  )

  const isDownloading = useMemo(() => {
    if (!defaultVariant) return false
    return (
      localDownloadingModels.has(defaultVariant.model_id) ||
      downloadProcesses.some((e) => e.id === defaultVariant.model_id)
    )
  }, [defaultVariant, localDownloadingModels, downloadProcesses])

  const downloadProgress = useMemo(() => {
    if (!defaultVariant) return 0
    return (
      downloadProcesses.find((e) => e.id === defaultVariant.model_id)
        ?.progress || 0
    )
  }, [defaultVariant, downloadProcesses])

  const isDownloaded = useMemo(() => {
    if (!defaultVariant) return false
    return llamaProvider?.models.some(
      (m: { id: string }) => m.id === defaultVariant.model_id
    )
  }, [defaultVariant, llamaProvider])

  // Handle quick start click (Desktop only)
  const handleQuickStart = useCallback(() => {
    if (!defaultVariant || !janModelV2) {
      console.error('Jan Model V2 not found in catalog')
      return
    }

    setQuickStartInitiated(true)
    addLocalDownloadingModel(defaultVariant.model_id)
    serviceHub
      .models()
      .pullModelWithMetadata(
        defaultVariant.model_id,
        defaultVariant.path,
        (
          janModelV2.mmproj_models?.find(
            (e) => e.model_id.toLowerCase() === 'mmproj-f16'
          ) || janModelV2.mmproj_models?.[0]
        )?.path,
        huggingfaceToken
      )
  }, [
    defaultVariant,
    janModelV2,
    addLocalDownloadingModel,
    serviceHub,
    huggingfaceToken,
  ])

  // Navigate to chat when download completes (Desktop only)
  useEffect(() => {
    if (quickStartInitiated && isDownloaded && defaultVariant) {
      // Mark setup as completed
      localStorage.setItem(localStorageKey.setupCompleted, 'true')

      // Navigate to chat with model selected
      navigate({
        to: route.home,
        params: {},
        search: {
          model: {
            id: defaultVariant.model_id,
            provider: 'llamacpp',
          },
        },
      })
    }
  }, [quickStartInitiated, isDownloaded, defaultVariant, navigate])

  // Get appropriate description based on platform
  const descriptionKey = isQuickStartAvailable
    ? 'setup:description'
    : 'setup:descriptionWeb'

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage></HeaderPage>
      <div className="h-full px-8 overflow-y-auto flex flex-col gap-2 justify-center ">
        <div className="w-full lg:w-4/6 mx-auto">
          <div className="mb-8 text-left">
            <h1 className="font-editorialnew text-main-view-fg text-4xl">
              {t('setup:welcome')}
            </h1>
            <p className="text-main-view-fg/70 text-lg mt-2">
              {t(descriptionKey)}
            </p>
          </div>
          <div className="flex gap-4 flex-col">
            {/* Quick Start Button - Highlighted */}
            {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
              <button
                onClick={handleQuickStart}
                disabled={isDownloading || isDownloaded || !defaultVariant}
                className="w-full text-left disabled:cursor-not-allowed"
              >
                <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-5 rounded-lg border-2 border-blue-500/50 hover:border-blue-500/70 transition-all hover:shadow-lg disabled:opacity-60 disabled:hover:border-blue-500/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                      {isDownloading ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-6 w-6 text-white animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-6 w-6 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <h1 className="text-main-view-fg font-semibold text-lg mb-1">
                        {isDownloading
                          ? t('setup:downloading', {
                              defaultValue: 'Downloading Jan Model...',
                            })
                          : t('setup:quickStart')}
                      </h1>
                      {isDownloading ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <Progress
                              value={downloadProgress * 100}
                              className="flex-1"
                            />
                            <span className="text-sm text-main-view-fg/70 font-medium min-w-[3rem] text-right">
                              {Math.round(downloadProgress * 100)}%
                            </span>
                          </div>
                          <p className="text-main-view-fg/70 text-xs">
                            {t('setup:downloadingDescription', {
                              defaultValue:
                                'Please wait while we download the model. This may take a few minutes.',
                            })}
                          </p>
                        </div>
                      ) : (
                        <p className="text-main-view-fg/70 text-sm">
                          {t('setup:quickStartDescription')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )}

            {/* "or" divider */}
            {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-main-view-fg/10"></div>
                <span className="text-main-view-fg/50 text-sm font-medium">
                  {t('setup:orDivider')}
                </span>
                <div className="flex-1 h-px bg-main-view-fg/10"></div>
              </div>
            )}

            {/* Set up local model */}
            {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
              <Link
                to={route.hub.index}
                search={{
                  ...(!isProd ? { step: 'setup_local_provider' } : {}),
                }}
              >
                <Card
                  header={
                    <div>
                      <h1 className="text-main-view-fg font-medium text-base">
                        {t('setup:localModel')}
                      </h1>
                    </div>
                  }
                />
              </Link>
            )}

            {/* Set up remote provider */}
            <Link
              to={route.settings.providers}
              params={{
                providerName: firstItemRemoteProvider,
              }}
              search={{
                ...(!isSetupCompleted ? { step: 'setup_remote_provider' } : {}),
              }}
            >
              <Card
                header={
                  <h1 className="text-main-view-fg font-medium text-base">
                    {t('setup:remoteProvider')}
                  </h1>
                }
              />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
