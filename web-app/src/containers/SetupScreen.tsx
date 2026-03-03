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
import { DownloadIcon, PanelLeft, ArrowRight, PlusIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useThreads } from '@/hooks/useThreads'
import { ACCENT_COLORS, type AccentColorValue, useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useTheme } from '@/hooks/useTheme'

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

const TYPING_PROMPTS = [
  'Plan a 5-day trip to Taiwan',
  'Create character ideas for a novel',
  'Suggest unit tests for this function',
  'Give me startup name ideas',
  'How can I sleep better?',
  'Make a pros and cons list',
  'What assumptions does this implementation make?',
]

function SetupChatInputPreview() {
  const [displayed, setDisplayed] = useState('')
  const [promptIndex, setPromptIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const current = TYPING_PROMPTS[promptIndex]
    if (!isDeleting) {
      if (charIndex < current.length) {
        timeoutRef.current = setTimeout(() => {
          setDisplayed(current.slice(0, charIndex + 1))
          setCharIndex((c) => c + 1)
        }, 45)
      } else {
        timeoutRef.current = setTimeout(() => setIsDeleting(true), 1800)
      }
    } else {
      if (charIndex > 0) {
        timeoutRef.current = setTimeout(() => {
          setDisplayed(current.slice(0, charIndex - 1))
          setCharIndex((c) => c - 1)
        }, 22)
      } else {
        setIsDeleting(false)
        setPromptIndex((i) => (i + 1) % TYPING_PROMPTS.length)
      }
    }
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [charIndex, isDeleting, promptIndex])

  return (
    <div className='relative z-10 w-full max-w-lg px-6'>
      <div className='relative overflow-hidden p-0.5 rounded-3xl'>
        <div className='relative z-20 px-0 pb-10 border rounded-3xl border-input bg-background backdrop-blur-sm'>
          <div className='pt-4 px-4 min-h-14 text-sm text-foreground/80'>
            {displayed}
            <span className='inline-block w-0.5 h-4 ml-0.5 bg-foreground/60 animate-pulse align-middle' />
          </div>
        </div>
        <div className='absolute z-20 bottom-0 w-full p-2'>
          <div className='flex justify-between items-center'>
            <div className='px-1 flex items-center gap-1'>
              <div className='p-1 rounded-full bg-secondary size-7 flex items-center justify-center opacity-50'>
                <PlusIcon size={16} className='text-muted-foreground' />
              </div>
            </div>
            <div className='rounded-full bg-primary size-7 flex items-center justify-center mr-1 mb-1 opacity-50'>
              <ArrowRight size={16} className='text-primary-foreground' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
  const globalTheme = useTheme((s) => s.activeTheme)
  const setGlobalTheme = useTheme((s) => s.setTheme)
  const globalAccentColor = useInterfaceSettings((s) => s.accentColor)
  const setGlobalAccentColor = useInterfaceSettings((s) => s.setAccentColor)
  const [pendingTheme, setPendingTheme] = useState<AppTheme>(globalTheme)
  const [pendingAccentColor, setPendingAccentColor] = useState<AccentColorValue>(globalAccentColor)
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
          <div className="shrink-0 px-10 w-[480px] overflow-auto pb-10 pointer-events-auto -mt-20">
            <div className="mb-4">
              <h1 className="font-studio font-medium text-2xl mb-1">
                {isDownloading ?  'While Jan gets ready...' : 'Hey, welcome to Jan!'}
              </h1>
              <p className='text-muted-foreground leading-normal w-full mt-1'>{isDownloading ? 'Explore the app or choose your theme.' : 'Jan needs a model to begin. Let’s set it up.'}</p>
            </div>

            {isDownloading ?
              <div className='mt-8 space-y-6'>
                    <div className='space-y-2.5'>
                      <div className='text-muted-foreground text-sm'>Accent color</div>
                      <div className='flex gap-2 flex-wrap'>
                        {ACCENT_COLORS.map((color) => (
                          <button
                            key={color.value}
                            onClick={() => setPendingAccentColor(color.value)}
                            className={cn(
                              'size-6 rounded-full ring-offset-background ring-offset-2 transition-all',
                              pendingAccentColor === color.value && 'ring-2 ring-foreground'
                            )}
                            style={{ backgroundColor: color.thumb }}
                            title={color.name}
                          />
                        ))}
                      </div>
                    </div>
                    <div className='space-y-2.5'>
                      <div className='text-muted-foreground text-sm'>Color system</div>
                      <div className='space-y-2'>
                        {(['auto', 'light', 'dark'] as const).map((theme) => (
                          <button
                            key={theme}
                            onClick={() => setPendingTheme(theme)}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-4 rounded-lg border text-sm transition-all text-left',
                              pendingTheme === theme ? 'border-primary/50' : 'border-input hover:border-muted-foreground'
                            )}
                          >
                            <span className={cn(
                              'size-4 rounded-full border-2 flex items-center justify-center shrink-0',
                              pendingTheme === theme ? 'border-primary' : 'border-muted-foreground/50'
                            )}>
                              {pendingTheme === theme && <span className='size-2 rounded-full bg-primary' />}
                            </span>
                            <span className='capitalize'>{theme === 'auto' ? 'System' : theme}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className='flex gap-2'>
                      <Button size='sm' className='flex-1' onClick={() => {
                        setGlobalTheme(pendingTheme)
                        setGlobalAccentColor(pendingAccentColor)
                      }}>
                        Apply
                      </Button>
                    </div>
              </div>
              :
              <div className="flex gap-4 flex-col mt-6 relative z-50">
                <div
                  className="w-full text-left"
                >
                  <span className='mb-2 block text-muted-foreground'>Recommended model</span>
                  <div className={cn("bg-secondary/50 p-3 rounded-lg border transition-all hover:shadow disabled:opacity-60 flex justify-between items-start")}>
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 size-12 bg-background rounded-xl flex items-center justify-center">
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
                  <div className="flex flex-col relative z-50 items-start gap-2 mt-4">
                    {!isDownloading &&
                      <Button size="sm" className='w-full' disabled={isDownloading} onClick={handleQuickStart}>
                        Download
                      </Button>}
                  </div>
                </div>
              </div>
            }
          </div>

          {!isDownloading && (
            <div className='w-full -top-7.5 -left-2 h-[calc(100%+42px)] relative flex items-center justify-center overflow-hidden rounded-2xl'>
              {/* Gradient background */}
              <img src='/images/onboarding-gradient.png' className='absolute inset-0 w-full h-full object-cover' />
              {/* Noise texture overlay */}
              <div className='absolute inset-0 opacity-30' style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")', backgroundSize: '128px 128px' }} />
              {/* Static ChatInput preview with typing animation */}
              <SetupChatInputPreview />
            </div>
          )}
          
          {isDownloading && (() => {
            const previewIsDark = pendingTheme === 'dark' || (pendingTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
            const colorObj = ACCENT_COLORS.find(c => c.value === pendingAccentColor) ?? ACCENT_COLORS[0]
            const contentBg = previewIsDark ? '#111111' : '#ffffff'
            const sidebarFrom = previewIsDark ? colorObj.sidebar.dark : colorObj.sidebar.light
            const sidebarBg = `linear-gradient(to bottom, ${sidebarFrom}, ${contentBg})`
            const skStyle = { background: previewIsDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.09)' }
            const mutedText = previewIsDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)'
            const borderCol = previewIsDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
            return (
              <div className='border-l border-t w-full mt-2 rounded-tl-2xl h-full p-2 relative transition-colors duration-300' style={{ background: contentBg }}>
                <div className='bg-clip-padding w-60 h-full rounded-xl shadow transition-colors duration-300' style={{ background: sidebarBg, borderColor: borderCol }}>
                  <div className='w-full p-4 pb-0 flex justify-between items-center'>
                    {IS_MACOS ?
                      <div className="flex gap-1.5">
                        <div className="size-2.5 rounded-full" style={{ background: mutedText }} />
                        <div className="size-2.5 rounded-full" style={{ background: mutedText }} />
                        <div className="size-2.5 rounded-full" style={{ background: mutedText }} />
                      </div>
                    :
                      <div>
                        <span className="font-studio font-medium" style={{ color: mutedText }}>Jan</span>
                      </div>}
                    <div className="flex gap-2.5" style={{ color: mutedText }}>
                      <DownloadIcon className="size-3" />
                      <PanelLeft className="size-3" />
                    </div>
                  </div>

                  <div className="p-4 space-y-4">
                    <div className="space-y-2">
                      <Skeleton className="w-20 h-2" style={skStyle} />
                      <ul className="space-y-2">
                        <li className="flex items-center gap-2"><Skeleton className="size-4" style={skStyle} /><Skeleton className="w-20 h-2" style={skStyle} /></li>
                        <li className="flex items-center gap-2"><Skeleton className="size-4" style={skStyle} /><Skeleton className="w-28 h-2" style={skStyle} /></li>
                        <li className="flex items-center gap-2"><Skeleton className="size-4" style={skStyle} /><Skeleton className="w-32 h-2" style={skStyle} /></li>
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="w-20 h-2" style={skStyle} />
                      <ul className="space-y-2">
                        <li className="flex items-center gap-2"><Skeleton className="size-4" style={skStyle} /><Skeleton className="w-20 h-2" style={skStyle} /></li>
                        <li className="flex items-center gap-2"><Skeleton className="size-4" style={skStyle} /><Skeleton className="w-28 h-2" style={skStyle} /></li>
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="w-20 h-2" style={skStyle} />
                      <ul className="space-y-2">
                        <li><Skeleton className="w-36 h-2" style={skStyle} /></li>
                        <li><Skeleton className="w-28 h-2" style={skStyle} /></li>
                        <li><Skeleton className="w-36 h-2" style={skStyle} /></li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
