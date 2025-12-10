import { Card } from './Card'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Link, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from './HeaderPage'
import { isProd } from '@/lib/version'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  localStorageKey,
  CACHE_EXPIRY_MS,
} from '@/constants/localStorage'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { Progress } from '@/components/ui/progress'
import type { CatalogModel } from '@/services/models/types'
import {
  JAN_MODEL_V2_HF_REPO,
  SETUP_SCREEN_QUANTIZATIONS,
} from '@/constants/models'
import { toast } from 'sonner'

const isQuickStartAvailable = PlatformFeatures[PlatformFeature.LOCAL_INFERENCE]

type CacheEntry = {
  status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY'
  timestamp: number
}

const modelSupportCache = new Map<string, CacheEntry>()

function loadCacheFromStorage() {
  try {
    const stored = localStorage.getItem(localStorageKey.modelSupportCache)
    if (stored) {
      const parsed = JSON.parse(stored)
      Object.entries(parsed).forEach(([key, value]) => {
        modelSupportCache.set(key, value as CacheEntry)
      })
    }
  } catch (error) {
    console.error('Failed to load model support cache:', error)
  }
}

function saveCacheToStorage() {
  try {
    const cacheObj = Object.fromEntries(modelSupportCache.entries())
    localStorage.setItem(
      localStorageKey.modelSupportCache,
      JSON.stringify(cacheObj)
    )
  } catch (error) {
    console.error('Failed to save model support cache:', error)
  }
}

function getCachedSupport(modelId: string): 'RED' | 'YELLOW' | 'GREEN' | 'GREY' | null {
  const entry = modelSupportCache.get(modelId)
  if (!entry) return null

  const now = Date.now()
  if (now - entry.timestamp > CACHE_EXPIRY_MS) {
    modelSupportCache.delete(modelId)
    return null
  }

  return entry.status
}

function setCachedSupport(modelId: string, status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY') {
  modelSupportCache.set(modelId, {
    status,
    timestamp: Date.now(),
  })
  saveCacheToStorage()
}

loadCacheFromStorage()

function SetupScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { providers, getProviderByName } = useModelProvider()
  const firstItemRemoteProvider =
    providers.length > 0 ? providers[1]?.provider : 'openai'

  // Check if setup tour has been completed
  const isSetupCompleted =
    localStorage.getItem(localStorageKey.setupCompleted) === 'true'
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const serviceHub = useServiceHub()
  const llamaProvider = getProviderByName('llamacpp')
  const [quickStartInitiated, setQuickStartInitiated] = useState(false)
  const [quickStartQueued, setQuickStartQueued] = useState(false)
  const [janModelV2, setJanModelV2] = useState<CatalogModel | null>(null)
  const [supportedVariants, setSupportedVariants] = useState<
    Map<string, 'RED' | 'YELLOW' | 'GREEN' | 'GREY'>
  >(new Map())
  const [metadataFetchFailed, setMetadataFetchFailed] = useState(false)
  const supportCheckInProgress = useRef(false)
  const checkedModelId = useRef<string | null>(null)
  const [isSupportCheckComplete, setIsSupportCheckComplete] = useState(false)

  const fetchJanModel = useCallback(async () => {
    if (!isQuickStartAvailable) return

    setMetadataFetchFailed(false)
    try {
      const repo = await serviceHub
        .models()
        .fetchHuggingFaceRepo(JAN_MODEL_V2_HF_REPO)

      if (repo) {
        const catalogModel = serviceHub.models().convertHfRepoToCatalogModel(repo)
        setJanModelV2(catalogModel)
      } else {
        setMetadataFetchFailed(true)
      }
    } catch (error) {
      console.error('Error fetching Jan Model V2:', error)
      setMetadataFetchFailed(true)
    }
  }, [serviceHub])

  // Check model support for variants when janModelV2 is available
  useEffect(() => {
    const checkModelSupport = async () => {
      if (!janModelV2) return

      if (
        supportCheckInProgress.current ||
        checkedModelId.current === janModelV2.model_name
      ) {
        return
      }

      supportCheckInProgress.current = true
      checkedModelId.current = janModelV2.model_name
      setIsSupportCheckComplete(false)

      const variantSupportMap = new Map<
        string,
        'RED' | 'YELLOW' | 'GREEN' | 'GREY'
      >()

      for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
        const variant = janModelV2.quants.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant) {
          const cached = getCachedSupport(variant.model_id)
          if (cached) {
            console.log(
              `[SetupScreen] ${variant.model_id}: ${cached} (cached)`
            )
            variantSupportMap.set(variant.model_id, cached)
            continue
          }

          try {
            console.log(
              `[SetupScreen] Checking support for ${variant.model_id}...`
            )
            const supportStatus = await serviceHub
              .models()
              .isModelSupported(variant.path)

            console.log(`[SetupScreen] ${variant.model_id}: ${supportStatus}`)
            setCachedSupport(variant.model_id, supportStatus)
            variantSupportMap.set(variant.model_id, supportStatus)
          } catch (error) {
            console.error(
              `[SetupScreen] Error checking support for ${variant.model_id}:`,
              error
            )
            variantSupportMap.set(variant.model_id, 'GREY')
            setCachedSupport(variant.model_id, 'GREY')
          }
        }
      }

      setSupportedVariants(variantSupportMap)
      supportCheckInProgress.current = false
      setIsSupportCheckComplete(true)
    }

    checkModelSupport()
  }, [janModelV2, serviceHub])

  useEffect(() => {
    fetchJanModel()
  }, [fetchJanModel])

  const defaultVariant = useMemo(() => {
    if (!janModelV2) return null

    const priorityOrder: Array<'GREEN' | 'YELLOW' | 'GREY'> = [
      'GREEN',
      'YELLOW',
      'GREY',
    ]

    for (const status of priorityOrder) {
      for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
        const variant = janModelV2.quants.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant && supportedVariants.get(variant.model_id) === status) {
          return variant
        }
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      if (quantization === 'q8_0') continue

      const variant = janModelV2.quants.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )

      if (variant && supportedVariants.get(variant.model_id) === 'RED') {
        return variant
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = janModelV2.quants.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )

      if (variant && supportedVariants.get(variant.model_id) === 'RED') {
        return variant
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = janModelV2.quants.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )
      if (variant) return variant
    }

    return janModelV2.quants[0]
  }, [janModelV2, supportedVariants])

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

  const handleQuickStart = useCallback(() => {
    // If metadata is still loading, queue the download
    if (!defaultVariant || !janModelV2 || !isSupportCheckComplete) {
      setQuickStartQueued(true)
      setQuickStartInitiated(true)
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
        undefined, // No HF token needed for public model
        true // Skip verification for faster download
      )
  }, [
    defaultVariant,
    janModelV2,
    isSupportCheckComplete,
    addLocalDownloadingModel,
    serviceHub,
  ])

  // Process queued quick start when metadata becomes available
  useEffect(() => {
    if (quickStartQueued && defaultVariant && janModelV2 && isSupportCheckComplete) {
      setQuickStartQueued(false)
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
          undefined,
          true
        )
    }
  }, [quickStartQueued, defaultVariant, janModelV2, isSupportCheckComplete, addLocalDownloadingModel, serviceHub])

  // Handle error when quick start is queued but metadata fetch fails
  useEffect(() => {
    if (quickStartQueued && metadataFetchFailed) {
      setQuickStartQueued(false)
      setQuickStartInitiated(false)
      toast.error(
        t('setup:quickStartFailed', {
          defaultValue: 'Something went wrong. Please try again.',
        })
      )
    }
  }, [quickStartQueued, metadataFetchFailed, t])

  useEffect(() => {
    if (quickStartInitiated && !quickStartQueued && !isDownloading && !isDownloaded) {
      setQuickStartInitiated(false)
    }
  }, [quickStartInitiated, quickStartQueued, isDownloading, isDownloaded])

  useEffect(() => {
    if (quickStartInitiated && isDownloaded && defaultVariant) {
      toast.dismiss(`model-validation-started-${defaultVariant.model_id}`)
      localStorage.setItem(localStorageKey.setupCompleted, 'true')

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

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage></HeaderPage>
      <div className="h-full px-8 overflow-y-auto flex flex-col gap-2 justify-center ">
        <div className="w-full lg:w-4/6 mx-auto">
          <div className="mb-8 text-left">
            <h1 className="font-editorialnew text-main-view-fg text-4xl">
              {t('setup:welcome')}
            </h1>
            {!isQuickStartAvailable && (
              <p className="text-main-view-fg/70 text-lg mt-2">
                {t('setup:descriptionWeb')}
              </p>
            )}
          </div>
          <div className="flex gap-4 flex-col">
            {/* Quick Start Button - Highlighted */}
            {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
              <button
                onClick={handleQuickStart}
                disabled={
                  quickStartInitiated ||
                  isDownloading ||
                  isDownloaded
                }
                className="w-full text-left"
              >
                <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-5 rounded-lg border-2 border-blue-500/50 hover:border-blue-500/70 transition-all hover:shadow-lg disabled:opacity-60 disabled:hover:border-blue-500/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                      {quickStartInitiated || isDownloading ? (
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
                        {quickStartInitiated || isDownloading
                          ? t('setup:downloading', {
                              defaultValue: 'Downloading Jan Model...',
                            })
                          : t('setup:quickStart')}
                      </h1>
                      {quickStartInitiated || isDownloading ? (
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
