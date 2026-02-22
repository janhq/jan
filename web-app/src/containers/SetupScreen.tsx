import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey, CACHE_EXPIRY_MS } from '@/constants/localStorage'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import Matter from 'matter-js'
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
import { DownloadIcon, PanelLeft} from 'lucide-react'
import { ThemeSwitcher } from './ThemeSwitcher'
import { AccentColorPicker } from './AccentColorPicker'
import { Skeleton } from '@/components/ui/skeleton'
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
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
        } else {
          const thread = await createThread(
            { id: '', provider: '' },
            'What is Jan?'
          )
          defaultThreadIdRef.current = thread.id

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
        }
      } catch (error) {
        console.error('Failed to create default thread/project:', error)
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

  // Matter.js physics-based falling logos animation
  useEffect(() => {
    if (isDownloading) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size - full screen
    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = width
    canvas.height = height

    // Setup Matter.js physics
    const Engine = Matter.Engine
    const Bodies = Matter.Bodies
    const Composite = Matter.Composite
    const Body = Matter.Body

    const engine = Engine.create()
    engine.world.gravity.y = 1

    // Create walls
    const wallOptions = { isStatic: true, friction: 1 }
    const ground = Bodies.rectangle(width / 2, height + 50, width, 100, wallOptions)
    const leftWall = Bodies.rectangle(-50, height / 2, 100, height * 2, wallOptions)
    const rightWall = Bodies.rectangle(width + 50, height / 2, 100, height * 2, wallOptions)

    Composite.add(engine.world, [ground, leftWall, rightWall])

    // Load logo
    const logo = new Image()
    logo.src = '/images/jan-logo.png'
    let logoLoaded = false
    logo.onload = () => {
      logoLoaded = true
    }

    // Store bodies for rendering
    const bodies: Matter.Body[] = []

    // Spawn bodies periodically
    const spawnInterval = setInterval(() => {
      if (bodies.length < 50) {
        for (let i = 0; i < 4; i++) {
          const size = 40 + Math.random() * 60
          const x = Math.random() * (width - 150) + 75
          const body = Bodies.circle(x, -100 - Math.random() * 150, size / 2, {
            restitution: 0.8,
            friction: 0.3,
            frictionAir: 0.01,
          })
          Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.2)
          bodies.push(body)
          Composite.add(engine.world, body)
        }
      }
    }, 500)

    // Drag state
    let draggedBody: Matter.Body | null = null
    let dragOffset = { x: 0, y: 0 }

    // Mouse down handler
    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Check if clicked on a body (iterate backwards for topmost first)
      for (let i = bodies.length - 1; i >= 0; i--) {
        const body = bodies[i]
        const dx = mouseX - body.position.x
        const dy = mouseY - body.position.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const radius = body.circleRadius!

        if (dist < radius) {
          draggedBody = body
          dragOffset.x = dx
          dragOffset.y = dy
          break
        }
      }
    }

    // Mouse move handler
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggedBody) return

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Move the body manually
      Body.setPosition(draggedBody, {
        x: mouseX - dragOffset.x,
        y: mouseY - dragOffset.y,
      })
      Body.setVelocity(draggedBody, { x: 0, y: 0 })
    }

    // Mouse up handler
    const handleMouseUp = () => {
      if (draggedBody) {
        // Apply bounce effect on release
        Body.applyForce(draggedBody, draggedBody.position, {
          x: (Math.random() - 0.5) * 0.05,
          y: -0.05 - Math.random() * 0.05,
        })
        Body.setAngularVelocity(draggedBody, draggedBody.angularVelocity + (Math.random() - 0.5) * 0.2)

        draggedBody = null
      }
    }

    // Click handler (for non-drag clicks)
    const handleClick = (e: MouseEvent) => {
      // Only bounce if not currently dragging
      if (draggedBody) return

      const rect = canvas.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickY = e.clientY - rect.top

      // Check if clicked on a body (iterate backwards for topmost first)
      for (let i = bodies.length - 1; i >= 0; i--) {
        const body = bodies[i]
        const dx = clickX - body.position.x
        const dy = clickY - body.position.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const radius = body.circleRadius!

        if (dist < radius) {
          // Apply bounce force
          Body.applyForce(body, body.position, {
            x: (Math.random() - 0.5) * 0.04,
            y: -0.06 - Math.random() * 0.04,
          })
          Body.setAngularVelocity(body, body.angularVelocity + (Math.random() - 0.5) * 0.2)
          break
        }
      }
    }

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseUp)
    canvas.addEventListener('click', handleClick)

    // Custom render loop
    let animationId: number
    const render = () => {
      // Update physics
      Engine.update(engine, 1000 / 60)

      // Clear canvas
      ctx.clearRect(0, 0, width, height)

      // Draw bodies
      for (const body of bodies) {
        const size = body.circleRadius! * 2

        if (logoLoaded && logo.complete) {
          ctx.save()
          ctx.translate(body.position.x, body.position.y)
          ctx.rotate(body.angle)
          ctx.globalAlpha = 1
          ctx.drawImage(logo, -size / 2, -size / 2, size, size)
          ctx.restore()
        } else {
          // Fallback circle
          ctx.beginPath()
          ctx.arc(body.position.x, body.position.y, body.circleRadius!, 0, 2 * Math.PI)
          ctx.fillStyle = `hsl(${(body.id * 25) % 360}, 70%, 55%)`
          ctx.fill()
        }
      }

      animationId = requestAnimationFrame(render)
    }

    render()

    return () => {
      clearInterval(spawnInterval)
      cancelAnimationFrame(animationId)
      Composite.clear(engine.world, false)
      Engine.clear(engine)
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('mouseleave', handleMouseUp)
      canvas.removeEventListener('click', handleClick)
    }
  }, [isDownloading])

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
      if (defaultThreadIdRef.current) {
        navigate({
          to: route.threadsDetail,
          params: { threadId: defaultThreadIdRef.current },
          search: {
            threadModel: {
              id: defaultVariant.model_id,
              provider: 'llamacpp',
            },
          },
          replace: true,
        })
      } else {
        navigate({
          to: route.home,
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
      {/* Full screen canvas background */}
      {!isDownloading && <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-auto z-50"
      />}
      
      {/* Content overlay - transparent to clicks on empty areas */}
        <div className="flex flex-col h-svh w-full">
        <HeaderPage />
        <div className="flex h-[calc(100%-60px)]">
          <div className="shrink-0 px-10 w-[480px] overflow-auto pb-10 pointer-events-auto">
            <div className="mb-4">
              <h1 className="font-studio font-medium text-2xl mb-1">
                {isDownloading ?  'While Jan gets ready...' : 'Hey, welcome to Jan!'}
              </h1>
              <p className='text-muted-foreground leading-normal w-full mt-1'>{isDownloading ? 'Want to try a different look? You can change this later in Settings.' : 'Let\'s download your first local AI model to run on your device.'}</p>
            </div>

            {isDownloading ?
              <div className='mt-8 space-y-6'>
                <div className='space-y-2.5'>
                  <div className='text-muted-foreground'>Accent color</div>
                  <AccentColorPicker />
                </div>
                <div className='space-y-2.5'>
                  <div className='text-muted-foreground'>Color system</div>
                  <ThemeSwitcher renderAsRadio />
                </div>
              </div>
              :
              <div className="flex gap-4 flex-col mt-6 relative z-50">
                <div
                  className="w-full text-left"
                >
                  <div className={cn("bg-background p-3 rounded-lg border transition-all hover:shadow disabled:opacity-60 flex justify-between items-start")}>
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
          {isDownloading && (
            <div className='border-l border-t w-full mt-2 rounded-tl-2xl h-full p-2 relative'>
              <div className='bg-linear-to-b bg-clip-padding border border-b-0 from-sidebar dark:from-sidebar/70 to-background w-60 h-full rounded-t-xl shadow'>
                <div className='w-full p-4 pb-0 flex justify-between items-center'>
                  {IS_MACOS ?
                    <div className="flex gap-1.5">
                      <div className="size-2.5 rounded-full bg-foreground/20"></div>
                      <div className="size-2.5 rounded-full bg-foreground/20"></div>
                      <div className="size-2.5 rounded-full bg-foreground/20"></div>
                    </div>
                  :
                    <div>
                      <span className="font-studio font-medium text-muted-foreground">Jan</span>
                    </div>}
                  <div className="flex gap-2.5 text-muted-foreground/80">
                    <DownloadIcon className="size-3" />
                    <PanelLeft className="size-3" />
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="w-20 h-2 bg-foreground/10" />
                    <ul className="space-y-2">
                      <li className="flex items-center gap-2">
                        <Skeleton className="size-4 bg-foreground/10" />
                        <Skeleton className="w-20 h-2 bg-foreground/10" />
                      </li>
                      <li className="flex items-center gap-2">
                        <Skeleton className="size-4 bg-foreground/10" />
                        <Skeleton className="w-30 h-2 bg-foreground/10" />
                      </li>
                      <li className="flex items-center gap-2">
                        <Skeleton className="size-4 bg-foreground/10" />
                        <Skeleton className="w-35 h-2 bg-foreground/10" />
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <Skeleton className="w-20 h-2 bg-foreground/10" />
                    <ul className="space-y-2">
                      <li className="flex items-center gap-2">
                        <Skeleton className="size-4 bg-foreground/10" />
                        <Skeleton className="w-20 h-2 bg-foreground/10" />
                      </li>
                      <li className="flex items-center gap-2">
                        <Skeleton className="size-4 bg-foreground/10" />
                        <Skeleton className="w-30 h-2 bg-foreground/10" />
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <Skeleton className="w-20 h-2 bg-foreground/10" />
                    <ul className="space-y-2">
                      <li><Skeleton className="w-40 h-2 bg-foreground/10" /></li>
                      <li><Skeleton className="w-30 h-2 bg-foreground/10" /></li>
                      <li><Skeleton className="w-40 h-2 bg-foreground/10" /></li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
