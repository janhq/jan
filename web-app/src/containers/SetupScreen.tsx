import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey, CACHE_EXPIRY_MS } from '@/constants/localStorage'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { ulid } from 'ulidx'
import { ChatCompletionRole, ContentType, MessageStatus, DownloadEvent, events } from '@janhq/core'
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
import { useThreads } from '@/hooks/useThreads'

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
  const { createThread } = useThreads()
  const threadCheckedRef = useRef(false)
  const defaultThreadIdRef = useRef<string | null>(null)
  // Create default thread and project for new user (only once)
  useEffect(() => {
    if (threadCheckedRef.current) return
    threadCheckedRef.current = true

    const setupDefaults = async () => {
      try {
        // Create default project "Getting started"
        const existingProjects = await serviceHub.projects().getProjects()
        const hasDefaultProject = existingProjects.some(
          (p) => p.name === 'Getting started'
        )
        let defaultProjectId: string | undefined
        if (!hasDefaultProject) {
          const project = await serviceHub.projects().addProject('Getting started')
          defaultProjectId = project.id
        } else {
          defaultProjectId = existingProjects.find((p) => p.name === 'Getting started')?.id
        }

        // Create default thread (outside of project)
        const existingThreads = await serviceHub.threads().fetchThreads()
        const defaultThread = existingThreads.find((t) => t.title === 'What is Jan?')
        if (defaultThread) {
          defaultThreadIdRef.current = defaultThread.id
          useThreads.getState().setThreads(await serviceHub.threads().fetchThreads())
        } else {
          const thread = await createThread(
            { id: '', provider: '' },
            'What is Jan?'
          )
          defaultThreadIdRef.current = thread.id

          // Refresh threads in store after creating default thread
          useThreads.getState().setThreads(await serviceHub.threads().fetchThreads())

          // Add dummy messages
          const now = Date.now()
          const messages = [
            {
              id: ulid(),
              object: 'message',
              thread_id: thread.id,
              role: ChatCompletionRole.User,
              content: [
                {
                  type: ContentType.Text,
                  text: { value: 'Hey, so what is Jan?', annotations: [] },
                },
              ],
              status: MessageStatus.Ready,
              created_at: now,
              completed_at: now,
            },
            {
              id: ulid(),
              object: 'message',
              thread_id: thread.id,
              role: ChatCompletionRole.Assistant,
              content: [
                {
                  type: ContentType.Text,
                  text: {
                    value:
                      "Hello, I'm Jan! I'm an open-source AI assistant built by the team at Menlo Research.\n\nI can help you answer questions, think through complex ideas, and solve problems, big or small, by using tools to complete them on your behalf. I run on your device, so you stay in control of your data and work.\n\nTo learn more about how I'm built, visit jan.ai, or explore the team's work at menlo.ai.",
                    annotations: [],
                  },
                },
              ],
              status: MessageStatus.Ready,
              created_at: now + 1,
              completed_at: now + 1,
            },
            {
              id: ulid(),
              object: 'message',
              thread_id: thread.id,
              role: ChatCompletionRole.User,
              content: [
                {
                  type: ContentType.Text,
                  text: { value: 'What can you do?', annotations: [] },
                },
              ],
              status: MessageStatus.Ready,
              created_at: now + 2,
              completed_at: now + 2,
            },
            {
              id: ulid(),
              object: 'message',
              thread_id: thread.id,
              role: ChatCompletionRole.Assistant,
              content: [
                {
                  type: ContentType.Text,
                  text: {
                    value:
                      "Quite a few things.\n\nYou can ask me questions, work through ideas, or get help with things like writing and code.\n\nYou can chat with me for quick questions, or start a project to organise longer work. You can also add files, and I'll use them as context.\n\nIf you like, you can switch between different models depending on what you're working on.\n\nWhat would you like to try first?",
                    annotations: [],
                  },
                },
              ],
              status: MessageStatus.Ready,
              created_at: now + 3,
              completed_at: now + 3,
            },
          ]

          for (const message of messages) {
            await serviceHub.messages().createMessage(message)
          }
        }

        // Create threads inside "Getting started" project
        if (defaultProjectId) {
          const projectMetadata = {
            id: defaultProjectId,
            name: 'Getting started',
            updated_at: Math.floor(Date.now() / 1000),
          }

          // Re-fetch threads to get the latest state
          const allThreads = await serviceHub.threads().fetchThreads()
          const projectThreads = allThreads.filter(
            (t) => t.metadata?.project?.id === defaultProjectId
          )

          // Thread 1: Exploring project assistants
          const existingAssistantThread = projectThreads.find(
            (t) => t.title === 'Exploring project assistants'
          )
          if (!existingAssistantThread) {
            const assistantThread = await createThread(
              { id: '', provider: '' },
              'Exploring project assistants',
              undefined,
              projectMetadata
            )

            const assistantMessages = [
              {
                id: ulid(),
                object: 'message',
                thread_id: assistantThread.id,
                role: ChatCompletionRole.User,
                content: [
                  {
                    type: ContentType.Text,
                    text: { value: 'How should I set up the assistant for a project?', annotations: [] },
                  },
                ],
                status: MessageStatus.Ready,
                created_at: Date.now(),
                completed_at: Date.now(),
              },
              {
                id: ulid(),
                object: 'message',
                thread_id: assistantThread.id,
                role: ChatCompletionRole.Assistant,
                content: [
                  {
                    type: ContentType.Text,
                    text: {
                      value:
                        "Think of the assistant as your project helper. You can choose one assistant per project. This helps keep guidance clear and avoids mixed responses.\n\nDescribe what the project is about, what you want help with, and how you want responses to sound.\n\nFor example, in a research project, you might write:\n\n\"Summarise clearly. Highlight key points and trade-offs. Flag anything uncertain or worth double-checking.\"\n\nA few clear lines are enough. You can change this anytime to tailor responses as your project evolves.",
                      annotations: [],
                    },
                  },
                ],
                status: MessageStatus.Ready,
                created_at: Date.now() + 1,
                completed_at: Date.now() + 1,
              },
            ]

            for (const message of assistantMessages) {
              await serviceHub.messages().createMessage(message)
            }
          }

          // Thread 2: Uploading helpful files
          const existingFilesThread = projectThreads.find(
            (t) => t.title === 'Uploading helpful files'
          )
          if (!existingFilesThread) {
            const filesThread = await createThread(
              { id: '', provider: '' },
              'Uploading helpful files',
              undefined,
              projectMetadata
            )

            const filesMessages = [
              {
                id: ulid(),
                object: 'message',
                thread_id: filesThread.id,
                role: ChatCompletionRole.User,
                content: [
                  {
                    type: ContentType.Text,
                    text: { value: 'What types of files should I add to a project to improve responses?', annotations: [] },
                  },
                ],
                status: MessageStatus.Ready,
                created_at: Date.now(),
                completed_at: Date.now(),
              },
              {
                id: ulid(),
                object: 'message',
                thread_id: filesThread.id,
                role: ChatCompletionRole.Assistant,
                content: [
                  {
                    type: ContentType.Text,
                    text: {
                      value:
                        "Add files you'd normally keep open while working:\n\n- Notes or docs if you're thinking through ideas\n- Drafts if you're writing or editing\n- Specs or tickets if you're planning work\n- PDFs or research if you need summaries or comparisons\n- Code files if you want help understanding or improving them\n\nI'll use these files as shared context, so you don't have to repeat yourself.",
                      annotations: [],
                    },
                  },
                ],
                status: MessageStatus.Ready,
                created_at: Date.now() + 1,
                completed_at: Date.now() + 1,
              },
            ]

            for (const message of filesMessages) {
              await serviceHub.messages().createMessage(message)
            }
          }

          // Refresh threads in store after creating project threads
          useThreads.getState().setThreads(await serviceHub.threads().fetchThreads())
        }
      } catch (error) {
        console.error('Failed to create default thread/project:', error)
        if (error instanceof Error) {
          console.error('Error name:', error.name)
          console.error('Error message:', error.message)
          console.error('Error stack:', error.stack)
        }
      }
    }

    setupDefaults()
  }, []) // Empty dependency - runs once on mount

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

   const downloadedSize = useMemo(() => {
    if (!defaultVariant) return { current: 0, total: 0 }
    const process = downloadProcesses.find(
      (e) => e.id === defaultVariant.model_id
    )
    return {
      current: process?.current || 0,
      total: process?.total || 0,
    }
  }, [defaultVariant, downloadProcesses])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0'
    const gb = bytes / (1024 * 1024 * 1024)
    return gb.toFixed(1)
  }

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

  // Use ref to track if we've already navigated
  const hasNavigatedRef = useRef(false)

  // Navigate when download completes - using event listener for reliability
  useEffect(() => {
    if (hasNavigatedRef.current) return

    const onDownloadSuccess = async (state: { modelId: string }) => {
      if (!defaultVariant || hasNavigatedRef.current) return
      if (state.modelId !== defaultVariant.model_id) return

      console.log('SetupScreen: Download completed, navigating to home...')
      hasNavigatedRef.current = true

      // Wait a bit for model provider to update
      await new Promise((resolve) => setTimeout(resolve, 500))

      toast.dismiss(`model-validation-started-${defaultVariant.model_id}`)
      localStorage.setItem(localStorageKey.setupCompleted, 'true')

      // Navigate to default thread if it exists, otherwise to home
      const threadId = defaultThreadIdRef.current
      let threadExists = false

      if (threadId) {
        try {
          const threads = await serviceHub.threads().fetchThreads()
          threadExists = threads.some((t) => t.id === threadId)
        } catch {
          threadExists = false
        }
      }

      if (threadId && threadExists) {
        // Update the thread with the downloaded model
        useThreads.getState().updateThread(threadId, {
          model: {
            id: defaultVariant.model_id,
            provider: 'llamacpp',
          },
        })

        navigate({
          to: route.threadsDetail,
          params: { threadId },
          search: {
            threadModel: {
              id: defaultVariant.model_id,
              provider: 'llamacpp',
            },
          },
          replace: true,
        })
      }
    }

    events.on(DownloadEvent.onFileDownloadAndVerificationSuccess, onDownloadSuccess)
    events.on(DownloadEvent.onFileDownloadSuccess, onDownloadSuccess)

    return () => {
      events.off(DownloadEvent.onFileDownloadAndVerificationSuccess, onDownloadSuccess)
      events.off(DownloadEvent.onFileDownloadSuccess, onDownloadSuccess)
    }
  }, [defaultVariant, navigate])

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


  return (
    <div className="relative flex flex-col h-svh w-full overflow-hidden">
      {/* Content overlay */}
        <div className="flex flex-col h-svh w-full">
        <HeaderPage />
        
        <div className="flex h-[calc(100%-60px)] items-center">
          <div className="shrink-0 px-10 w-[480px] mx-auto overflow-auto pb-10 pointer-events-auto -mt-20">
            <div className="mb-4">
              <h1 className="font-studio font-medium text-2xl mb-1">
                {isDownloading ?  'Sit tight, Jan is getting ready...' : 'Hey, welcome to Jan!'}
              </h1>
              <p className='text-muted-foreground leading-normal w-full mt-1'>{isDownloading ? 'This may take a few minutes.' : 'Jan needs a model to begin. Let’s set it up.'}</p>
            </div>
            <div className="flex gap-4 flex-col mt-6 relative z-50">
              <div
                className="w-full text-left"
              >
                <span className='mb-2 block text-sm font-medium'>Recommended model</span>
                <div className={cn("bg-secondary/50 p-3 rounded-lg border transition-all hover:shadow disabled:opacity-60 flex justify-between items-start")}>
                  <div className="flex w-full items-start gap-4">
                    <div className="shrink-0 size-12 bg-background rounded-xl flex items-center justify-center">
                      <img src="/images/jan-logo.png" alt="Jan Logo" className='size-6' />
                    </div>
                    <div className="flex flex-col w-full h-full justify-center">
                      <div className="flex flex-1 items-center justify-between">
                        <h1 className="font-semibold text-sm mb-1">
                          <span>Jan v3</span>&nbsp;<span className='text-xs text-muted-foreground'>· {defaultVariant?.file_size}</span>
                        </h1>
                        {(isDownloading) && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <svg
                              className="size-3 animate-spin"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            <span>{formatBytes(downloadedSize.current)} / {formatBytes(downloadedSize.total)}GB</span>
                          </div>
                        )}

                      </div>
                      <div className="text-muted-foreground text-sm mt-1.5 ">
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
                <div className="flex flex-col relative z-50 items-start gap-2 mt-4">
                  <Button size="sm" disabled={isDownloading}  onClick={handleQuickStart} className='flex items-center gap-2 w-full'>
                    {isDownloading ? 'Downloading' : 'Download'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

export default SetupScreen
