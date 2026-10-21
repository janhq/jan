import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@janhq/core'
import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant | undefined
  loading: boolean
  defaultAssistantId: string
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => Promise<void>
  setCurrentAssistant: (
    assistant: Assistant | undefined,
    saveToStorage?: boolean
  ) => void
  setDefaultAssistant: (id: string) => void
  setAssistants: (assistants: Assistant[] | null) => void
}

const setLastUsedAssistantId = (assistantId: string) => {
  try {
    localStorage.setItem(localStorageKey.lastUsedAssistant, assistantId)
  } catch (error) {
    console.debug('Failed to set last used assistant in localStorage:', error)
  }
}

export const defaultAssistant: Assistant = {
  id: 'jan',
  name: 'Jan',
  created_at: 1747029866.542,
  parameters: {},
  avatar: '👋',
  description:
    "Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user's behalf.",
  instructions: `You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`,
}

const getLastUsedAssistantId = (assistants: Assistant[]): string => {
  let lastUsedId
  try {
    lastUsedId = localStorage.getItem(localStorageKey.lastUsedAssistant)
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
  }

  if (lastUsedId) {
    const lastUsedAssistant = assistants.find((a) => a.id === lastUsedId)
    if (lastUsedAssistant) {
      return lastUsedId
    }
  }

  if (lastUsedId === '') return ''

  return defaultAssistant.id
}

const getDefaultAssistantId = (): string | null => {
  let defaultAssistantId: string | null = null

  try {
    defaultAssistantId = localStorage.getItem(localStorageKey.defaultAssistantId)
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
  }

  return defaultAssistantId
}

const setDefaultAssistantId = (assistantId: string) => {
  try {
    if (!assistantId) {
      localStorage.removeItem(localStorageKey.defaultAssistantId)
    }
    else {
      localStorage.setItem(localStorageKey.defaultAssistantId, assistantId)
    }
  } catch (error) {
    console.debug('Failed to set default assistant in localStorage:', error)
  }
}

// Platform-aware initial state
const getInitialAssistantState = () => {
  return {
    assistants: [defaultAssistant],
    currentAssistant: defaultAssistant,
    defaultAssistantId: '',
    loading: true,
  }
}

export const useAssistant = create<AssistantState>((set, get) => ({
  ...getInitialAssistantState(),
  addAssistant: (assistant) => {
    set({ assistants: [...get().assistants, assistant] })
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to create assistant:', error)
      })
  },
  updateAssistant: (assistant) => {
    const state = get()
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      // Update currentAssistant if it's the same assistant being updated
      currentAssistant:
        state.currentAssistant?.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    // Create assistant already cover update logic
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to update assistant:', error)
      })
  },
  deleteAssistant: async (id) => {
    const assistant = get().assistants.find((entry) => entry.id === id)
    if (!assistant) return
    await getServiceHub().assistants().deleteAssistant(assistant as unknown as CoreAssistant)

    // Read the current state after persistence: selection may have changed
    // while the filesystem operation was pending.
    const state = get()
    const wasCurrentAssistant = state.currentAssistant?.id === id
    const wasDefaultAssistant = state.defaultAssistantId === id
    set({
      assistants: state.assistants.filter((entry) => entry.id !== id),
      ...(wasCurrentAssistant
        ? { currentAssistant: state.assistants.find((entry) => entry.id === defaultAssistant.id && entry.id !== id) }
        : {}),
      ...(wasDefaultAssistant ? { defaultAssistantId: defaultAssistant.id } : {}),
    })
    if (wasCurrentAssistant) setLastUsedAssistantId(defaultAssistant.id)
    if (wasDefaultAssistant) setDefaultAssistantId(defaultAssistant.id)
  },
  setDefaultAssistant: (id) => {
    const newAssistant = get().assistants?.find(a => a.id === id)
    if (newAssistant) {
      set({ defaultAssistantId: id, currentAssistant: newAssistant })
      setLastUsedAssistantId(id)
    }
    else {
      set({ defaultAssistantId: id })
    }
    setDefaultAssistantId(id)
  },
  setCurrentAssistant: (assistant, saveToStorage = true) => {
    const currentAssistant = get().currentAssistant
    if (currentAssistant !== assistant) {
      set({ currentAssistant: assistant })
      if (saveToStorage) {
        setLastUsedAssistantId(assistant?.id || '')
      }
    }
  },
  setAssistants: (assistants) => {
    if (assistants) {
      assistants.forEach((a) => (a.id = a.id?.toString())) // new String("id") !== "id"
      const lastUsedId = getLastUsedAssistantId(assistants)
      const lastUsedAssist = assistants.find((a) => a.id === lastUsedId)
      const defaultAssistantId = getDefaultAssistantId() || ''
      const defaultAssistant = assistants.find((a) => a.id === defaultAssistantId)
      set({
        assistants,
        currentAssistant: defaultAssistant || lastUsedAssist,
        defaultAssistantId,
        loading: false
      })
    } else {
      set({ loading: false })
    }
  },
}))
