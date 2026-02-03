import { create } from 'zustand'
import {
  getOpenCodeService,
  type OpenCodeTask,
  type OpenCodeMessage,
  type TaskStatus,
  type OpenCodeServiceInterface,
} from '@/services/opencode'

interface OpenCodeState {
  // State
  tasks: Map<string, OpenCodeTask>
  activeTaskId: string | null
  initialized: boolean

  // Actions
  initialize: () => void
  startTask: (params: {
    projectPath: string
    prompt: string
    agent?: 'build' | 'plan' | 'explore'
    apiKey?: string
  }) => Promise<string>
  cancelTask: (taskId: string) => Promise<void>
  respondToPermission: (
    taskId: string,
    permissionId: string,
    action: 'allow_once' | 'allow_always' | 'deny',
    message?: string
  ) => Promise<void>
  sendInput: (taskId: string, text: string) => Promise<void>
  setActiveTask: (taskId: string | null) => void
  clearCompletedTasks: () => void

  // Selectors
  getTask: (taskId: string) => OpenCodeTask | undefined
  getActiveTask: () => OpenCodeTask | undefined
  getRunningTasks: () => OpenCodeTask[]
}

// Service instance (lazy initialized)
let service: OpenCodeServiceInterface | null = null

export const useOpenCode = create<OpenCodeState>((set, get) => ({
  tasks: new Map(),
  activeTaskId: null,
  initialized: false,

  initialize: () => {
    if (get().initialized) return

    // Initialize service
    service = getOpenCodeService()
    set({ initialized: true })
  },

  startTask: async ({ projectPath, prompt, agent, apiKey }) => {
    const state = get()
    if (!state.initialized) {
      state.initialize()
    }
    if (!service) {
      throw new Error('OpenCode service not initialized')
    }

    // Generate task ID on frontend so we can set up listeners BEFORE starting
    const taskId = crypto.randomUUID()

    // Create initial task state
    const now = Date.now()
    const task: OpenCodeTask = {
      taskId,
      projectPath,
      prompt,
      agent,
      status: 'starting',
      events: [],
      createdAt: now,
      updatedAt: now,
    }

    // Add to state BEFORE starting to ensure UI updates
    const newTasks = new Map(state.tasks)
    newTasks.set(taskId, task)
    set({ tasks: newTasks, activeTaskId: taskId })

    // Subscribe to events BEFORE starting the task to avoid race condition
    const unsubscribeEvent = service.onEvent(taskId, (message) => {
      console.log('[useOpenCode] Event received:', taskId, message.type)
      handleMessage(taskId, message, get, set)
    })

    // Subscribe to status changes BEFORE starting the task
    const unsubscribeStatus = service.onStatusChange(taskId, (status) => {
      console.log('[useOpenCode] Status change:', taskId, status)
      updateTaskStatus(taskId, status as TaskStatus, get, set)
    })

    // Small delay to ensure listeners are set up
    await new Promise(resolve => setTimeout(resolve, 50))

    // Now start the task with the pre-generated ID
    try {
      await service.startTask({ taskId, projectPath, prompt, agent, apiKey })
      console.log('[useOpenCode] Task started:', taskId)
    } catch (error) {
      console.error('[useOpenCode] Task start failed:', error)
      // Clean up on failure
      unsubscribeEvent()
      unsubscribeStatus()
      // Update state to reflect error
      const errorTasks = new Map(get().tasks)
      const errorTask = errorTasks.get(taskId)
      if (errorTask) {
        errorTasks.set(taskId, {
          ...errorTask,
          status: 'error',
          error: { code: 'START_FAILED', message: String(error) },
          updatedAt: Date.now(),
        })
        set({ tasks: errorTasks })
      }
      throw error
    }

    return taskId
  },

  cancelTask: async (taskId) => {
    if (!service) return

    await service.cancelTask(taskId)

    // Update local state
    const { tasks } = get()
    const task = tasks.get(taskId)
    if (task) {
      const newTasks = new Map(tasks)
      newTasks.set(taskId, {
        ...task,
        status: 'cancelled',
        updatedAt: Date.now(),
      })
      set({ tasks: newTasks })
    }
  },

  respondToPermission: async (taskId, permissionId, action, message) => {
    if (!service) return

    await service.respondToPermission(taskId, permissionId, action, message)

    // Update local state - clear pending permission
    const { tasks } = get()
    const task = tasks.get(taskId)
    if (task) {
      const newTasks = new Map(tasks)
      newTasks.set(taskId, {
        ...task,
        status: 'running',
        pendingPermission: undefined,
        updatedAt: Date.now(),
      })
      set({ tasks: newTasks })
    }
  },

  sendInput: async (taskId, text) => {
    if (!service) return
    await service.sendInput(taskId, text)
  },

  setActiveTask: (taskId) => {
    set({ activeTaskId: taskId })
  },

  clearCompletedTasks: () => {
    const { tasks, activeTaskId } = get()
    const newTasks = new Map<string, OpenCodeTask>()

    for (const [id, task] of tasks) {
      // Keep running tasks and the active task
      if (
        task.status === 'starting' ||
        task.status === 'ready' ||
        task.status === 'running' ||
        task.status === 'waiting_permission' ||
        id === activeTaskId
      ) {
        newTasks.set(id, task)
      }
    }

    set({ tasks: newTasks })
  },

  getTask: (taskId) => get().tasks.get(taskId),

  getActiveTask: () => {
    const { activeTaskId, tasks } = get()
    return activeTaskId ? tasks.get(activeTaskId) : undefined
  },

  getRunningTasks: () => {
    const { tasks } = get()
    const running: OpenCodeTask[] = []
    for (const task of tasks.values()) {
      if (
        task.status === 'starting' ||
        task.status === 'ready' ||
        task.status === 'running' ||
        task.status === 'waiting_permission'
      ) {
        running.push(task)
      }
    }
    return running
  },
}))

/**
 * Handle incoming OpenCode messages
 */
function handleMessage(
  taskId: string,
  message: OpenCodeMessage,
  get: () => OpenCodeState,
  set: (state: Partial<OpenCodeState>) => void
) {
  console.log('[handleMessage] Processing message for task:', taskId, 'type:', message.type)

  const { tasks } = get()
  const task = tasks.get(taskId)
  if (!task) {
    console.warn('[handleMessage] Task not found:', taskId, 'Available tasks:', Array.from(tasks.keys()))
    return
  }

  const now = Date.now()
  const updatedTask = { ...task, updatedAt: now }

  switch (message.type) {
    case 'ready':
      console.log('[handleMessage] Task ready:', taskId)
      updatedTask.status = 'ready'
      break

    case 'event':
      console.log('[handleMessage] Event:', taskId, message.payload.event.type)
      updatedTask.events = [...updatedTask.events, message.payload.event]

      // Update status based on event type
      if (message.payload.event.type === 'session.started') {
        updatedTask.sessionId = message.payload.event.sessionId
        updatedTask.status = 'running'
      }
      break

    case 'permission_request':
      console.log('[handleMessage] Permission request:', taskId)
      updatedTask.status = 'waiting_permission'
      updatedTask.pendingPermission = message.payload
      break

    case 'result':
      console.log('[handleMessage] Result:', taskId, message.payload.status)
      updatedTask.status = message.payload.status
      updatedTask.result = message.payload
      break

    case 'error':
      console.log('[handleMessage] Error:', taskId, message.payload)
      updatedTask.status = 'error'
      updatedTask.error = message.payload
      break
  }

  const newTasks = new Map(tasks)
  newTasks.set(taskId, updatedTask)
  set({ tasks: newTasks })
}

/**
 * Update task status
 */
function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  get: () => OpenCodeState,
  set: (state: Partial<OpenCodeState>) => void
) {
  const { tasks } = get()
  const task = tasks.get(taskId)
  if (!task) return

  const newTasks = new Map(tasks)
  newTasks.set(taskId, {
    ...task,
    status,
    updatedAt: Date.now(),
  })
  set({ tasks: newTasks })
}

// ============================================================================
// Selector Hooks
// ============================================================================

/**
 * Get a specific task by ID
 */
export function useOpenCodeTask(taskId: string | null) {
  return useOpenCode((state) => (taskId ? state.tasks.get(taskId) : undefined))
}

/**
 * Get the active task
 */
export function useActiveOpenCodeTask() {
  return useOpenCode((state) => {
    const { activeTaskId, tasks } = state
    return activeTaskId ? tasks.get(activeTaskId) : undefined
  })
}

/**
 * Get all running tasks
 */
export function useRunningOpenCodeTasks() {
  return useOpenCode((state) => {
    const { tasks } = state
    const running: OpenCodeTask[] = []
    for (const task of tasks.values()) {
      if (
        task.status === 'starting' ||
        task.status === 'ready' ||
        task.status === 'running' ||
        task.status === 'waiting_permission'
      ) {
        running.push(task)
      }
    }
    return running
  })
}

/**
 * Check if any task is running
 */
export function useHasRunningOpenCodeTasks() {
  return useOpenCode((state) => state.getRunningTasks().length > 0)
}
