import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey, CACHE_EXPIRY_MS } from '@/constants/localStorage'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import type { CatalogModel } from '@/services/models/types'
import {
  NEW_JAN_MODEL_HF_REPO,
  SETUP_SCREEN_QUANTIZATIONS,
} from '@/constants/models'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { IconEye, IconSquareCheck } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import HeaderPage from './HeaderPage'
import { DownloadIcon, FolderIcon, FolderPlusIcon, MessageCircle, PanelLeft, Search } from 'lucide-react'
import { NavMain } from '@/components/left-sidebar/NavMain'
import { ThemeSwitcher } from './ThemeSwitcher'
import { AccentColorPicker } from './AccentColorPicker'
import { Skeleton } from '@/components/ui/skeleton'

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

function getCachedSupport(
  modelId: string
): 'RED' | 'YELLOW' | 'GREEN' | 'GREY' | null {
  const entry = modelSupportCache.get(modelId)
  if (!entry) return null

  const now = Date.now()
  if (now - entry.timestamp > CACHE_EXPIRY_MS) {
    modelSupportCache.delete(modelId)
    return null
  }

  return entry.status
}

function setCachedSupport(
  modelId: string,
  status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY'
) {
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
  const { getProviderByName } = useModelProvider()

  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const serviceHub = useServiceHub()
  const llamaProvider = getProviderByName('llamacpp')
  const [quickStartInitiated, setQuickStartInitiated] = useState(false)
  const [quickStartQueued, setQuickStartQueued] = useState(false)
  const [janNewModel, setJanNewModel] = useState<CatalogModel | null>(null)
  const [supportedVariants, setSupportedVariants] = useState<
    Map<string, 'RED' | 'YELLOW' | 'GREEN' | 'GREY'>
  >(new Map())
  const [metadataFetchFailed, setMetadataFetchFailed] = useState(false)
  const supportCheckInProgress = useRef(false)
  const checkedModelId = useRef<string | null>(null)
  const [isSupportCheckComplete, setIsSupportCheckComplete] = useState(false)
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)

  const fetchJanModel = useCallback(async () => {
    setMetadataFetchFailed(false)
    try {
      const repo = await serviceHub
        .models()
        .fetchHuggingFaceRepo(NEW_JAN_MODEL_HF_REPO, huggingfaceToken)

      if (repo) {
        const catalogModel = serviceHub
          .models()
          .convertHfRepoToCatalogModel(repo)
        setJanNewModel(catalogModel)
      } else {
        setMetadataFetchFailed(true)
      }
    } catch (error) {
      console.error('Error fetching Jan Model V2:', error)
      setMetadataFetchFailed(true)
    }
  }, [serviceHub, huggingfaceToken])

  // Check model support for variants when janNewModel is available
  useEffect(() => {
    const checkModelSupport = async () => {
      if (!janNewModel) return

      if (
        supportCheckInProgress.current ||
        checkedModelId.current === janNewModel.model_name
      ) {
        return
      }

      supportCheckInProgress.current = true
      checkedModelId.current = janNewModel.model_name
      setIsSupportCheckComplete(false)

      const variantSupportMap = new Map<
        string,
        'RED' | 'YELLOW' | 'GREEN' | 'GREY'
      >()

      for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
        const variant = janNewModel.quants?.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant) {
          const cached = getCachedSupport(variant.model_id)
          if (cached) {
            console.log(`[SetupScreen] ${variant.model_id}: ${cached} (cached)`)
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
  }, [janNewModel, serviceHub])

  useEffect(() => {
    fetchJanModel()
  }, [fetchJanModel])


  const defaultVariant = useMemo(() => {
    if (!janNewModel) return null

    const priorityOrder: Array<'GREEN' | 'YELLOW' | 'GREY'> = [
      'GREEN',
      'YELLOW',
      'GREY',
    ]

    for (const status of priorityOrder) {
      for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
        const variant = janNewModel.quants?.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant && supportedVariants.get(variant.model_id) === status) {
          return variant
        }
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      if (quantization === 'q8_0') continue

      const variant = janNewModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )

      if (variant && supportedVariants.get(variant.model_id) === 'RED') {
        return variant
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = janNewModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )

      if (variant && supportedVariants.get(variant.model_id) === 'RED') {
        return variant
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = janNewModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )
      if (variant) return variant
    }

    return janNewModel.quants?.[0]
  }, [janNewModel, supportedVariants])

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

  const isDownloaded = useMemo(() => {
    if (!defaultVariant) return false
    return llamaProvider?.models.some(
      (m: { id: string }) => m.id === defaultVariant.model_id
    )
  }, [defaultVariant, llamaProvider])

  const handleQuickStart = useCallback(() => {
    // If metadata is still loading, queue the download
    if (!defaultVariant || !janNewModel || !isSupportCheckComplete) {
      setQuickStartQueued(true)
      setQuickStartInitiated(true)
      return
    }

    setQuickStartInitiated(true)
    addLocalDownloadingModel(defaultVariant.model_id)
    serviceHub.models().pullModelWithMetadata(
      defaultVariant.model_id,
      defaultVariant.path,
      (
        janNewModel.mmproj_models?.find(
          (e) => e.model_id.toLowerCase() === 'mmproj-f16'
        ) || janNewModel.mmproj_models?.[0]
      )?.path,
      huggingfaceToken, // Use HF token from general settings
      true // Skip verification for faster download
    )
  }, [
    defaultVariant,
    janNewModel,
    isSupportCheckComplete,
    addLocalDownloadingModel,
    serviceHub,
    huggingfaceToken,
  ])

  // Process queued quick start when metadata becomes available
  useEffect(() => {
    if (
      quickStartQueued &&
      defaultVariant &&
      janNewModel &&
      isSupportCheckComplete
    ) {
      setQuickStartQueued(false)
      addLocalDownloadingModel(defaultVariant.model_id)
      serviceHub
        .models()
        .pullModelWithMetadata(
          defaultVariant.model_id,
          defaultVariant.path,
          (
            janNewModel.mmproj_models?.find(
              (e) => e.model_id.toLowerCase() === 'mmproj-f16'
            ) || janNewModel.mmproj_models?.[0]
          )?.path,
          undefined,
          true
        )
    }
  }, [
    quickStartQueued,
    defaultVariant,
    janNewModel,
    isSupportCheckComplete,
    addLocalDownloadingModel,
    serviceHub,
  ])

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
    if (
      quickStartInitiated &&
      !quickStartQueued &&
      isDownloading &&
      !isDownloaded
    ) {
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
    <div className="flex flex-col h-svh w-full">
      <HeaderPage />
      <div className="flex h-[calc(100%-60px)] gap-2">
        <div className="shrink-0 px-10 w-1/2 overflow-auto pb-10">
          <div className="mb-4">
            <h1 className="font-studio font-medium text-2xl mb-1">
              {isDownloading ?  'While Jan gets ready...' : 'Hey, welcome to Jan!'}
            </h1>
            <p className='text-muted-foreground leading-normal w-full mt-1'>{isDownloading ? 'Want to try a different look? You can change this later in Settings.' : 'Let’s download your first local AI model to run on your device.'}</p>
          </div>

          {isDownloading ? 
            <div className='mt-8 space-y-6'>
              <div className='space-y-4'>
                <div className='text-muted-foreground'>Accent color</div>
                <AccentColorPicker />
              </div> 
              <div className='space-y-4'>
                <div className='text-muted-foreground'>Color system</div>
                <ThemeSwitcher renderAsRadio />
              </div>
          </div>
            : 
            <div className="flex gap-4 flex-col mt-6">
              {/* Quick Start Button - Highlighted */}
              <div
                onClick={handleQuickStart}
                className="w-full text-left"
              >
                <div className={cn("bg-background p-3 rounded-lg border transition-all hover:shadow-lg disabled:opacity-60 flex justify-between items-start")}>
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 size-12 bg-secondary/40 rounded-xl flex items-center justify-center">
                      <img src="/images/jan-logo.png" alt="Jan Logo" className='size-6' />
                    </div>
                    <div className="flex-1">
                      <h1 className="font-semibold text-sm mb-1">
                        <span>Jan v3</span>&nbsp;<span className='text-xs text-muted-foreground'>· {defaultVariant?.file_size}</span>
                      </h1>
                      <div className="text-muted-foreground text-sm mt-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary text-xs rounded-full mr-1">
                          <IconSquareCheck size={12} />
                          General
                        </span>
                        {(janNewModel?.mmproj_models?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary text-xs rounded-full">
                          <IconEye size={12} />
                          Vision
                        </span>}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2 mt-6">
                  {quickStartInitiated || !isDownloading && 
                    <Button size="sm" className='w-full' disabled={isDownloading}>
                      Download
                    </Button>}
                </div>
              </div>
            </div>
          }
        </div>
        {quickStartInitiated || !isDownloading ? 
          <>
          </>
          : 
          <div className='border-l border-t w-full mt-2 rounded-tl-2xl h-full p-2 relative'>
            <div className='bg-linear-to-b bg-clip-padding border from-sidebar dark:from-sidebar/70 to-background w-60 h-full rounded-t-xl shadow'>
              <div className='w-full p-4 flex justify-between items-center'>
                {IS_MACOS ? 
                  <div className='flex gap-1.5'>
                    <div className='size-2.5 rounded-full bg-red-500'></div>
                    <div className='size-2.5 rounded-full bg-yellow-500'></div>
                    <div className='size-2.5 rounded-full bg-green-500'></div>
                  </div>
                : 
                  <div>
                    <span className='font-studio font-medium'>Jan</span>
                  </div>}
                <div className='flex gap-2.5 text-muted-foreground/80'>
                  <DownloadIcon className='size-3' />
                  <PanelLeft className='size-3' />
                </div>
              </div>
              
              <div className='px-2 mt-2'>
                <div className='px-2 mt-2 text-muted-foreground/80'>
                  <ul className='mt-3 space-y-3'>
                    <li className='flex items-center gap-2'>
                      <Skeleton className='size-4' />
                      <Skeleton className='w-20 h-2' />
                    </li>
                    <li className='flex items-center gap-2'>
                      <Skeleton className='size-4' />
                      <Skeleton className='w-30 h-2' />
                    </li>
                    <li className='flex items-center gap-2'>
                      <Skeleton className='size-4' />
                      <Skeleton className='w-35 h-2' />
                    </li>
                    <li className='flex items-center gap-2'>
                      <Skeleton className='size-4' />
                      <Skeleton className='w-25 h-2' />
                    </li>
                  </ul>
                </div>

                <div className='px-2 mt-6 text-muted-foreground/80'>
                  <Skeleton className='w-20 h-2' />
                  <ul className='mt-3 space-y-3'>
                    <li className='flex items-center gap-2'>
                      <Skeleton className='size-4' />
                      <Skeleton className='w-20 h-2' />
                    </li>
                    <li className='flex items-center gap-2'>
                      <Skeleton className='size-4' />
                      <Skeleton className='w-30 h-2' />
                    </li>

                  </ul>
                </div>

                <div className='px-2 mt-6 text-muted-foreground/80'>
                  <Skeleton className='w-20 h-2' />
                  <ul className='mt-3 space-y-3'>
                    <li className='truncate'>
                      <Skeleton className='w-40 h-2' />
                    </li>
                    <li className='truncate'>
                      <Skeleton className='w-30 h-2' />
                    </li>
                    <li className='truncate'>
                      <Skeleton className='w-40 h-2' />
                    </li>
                    <li className='truncate'>
                      <Skeleton className='w-30 h-2' />
                    </li>
                  </ul>
                </div>

              </div>
                
            </div>
          </div>
        }
      </div>
    </div>
  )
}

export default SetupScreen
