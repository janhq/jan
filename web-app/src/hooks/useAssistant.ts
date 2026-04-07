import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@janhq/core'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant | undefined
  loading: boolean
  // Persisted fields — only these two survive across sessions
  lastUsedAssistantId: string
  defaultAssistantId: string
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (
    assistant: Assistant | undefined,
    saveToStorage?: boolean
  ) => void
  setDefaultAssistant: (id: string) => void
  setAssistants: (assistants: Assistant[] | null) => void
}

export const defaultAssistant: Assistant = {
  id: 'jan',
  name: 'Jan',
  created_at: 1747029866.542,
  parameters: {
    temperature: 0.7,
    top_k: 20,
    top_p: 0.8,
    repeat_penalty: 1.12,
  },
  avatar: '👋',
  description:
    "Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user's behalf.",
  instructions: `You are Jan, a helpful AI assistant who assists users with their requests. Jan is trained by Menlo Research (https://www.menlo.ai).

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

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

// Re-compute currentAssistant from a loaded assistants list given the
// persisted preference IDs.  Exported so onRehydrateStorage can call it too.
function resolveCurrentAssistant(
  assistants: Assistant[],
  lastUsedAssistantId: string,
  defaultAssistantId: string
): Assistant {
  const byDefault = assistants.find((a) => a.id === defaultAssistantId)
  const byLastUsed = assistants.find((a) => a.id === lastUsedAssistantId)
  return byDefault ?? byLastUsed ?? defaultAssistant
}

export const useAssistant = create<AssistantState>()(
  persist(
    (set, get) => ({
      assistants: [defaultAssistant],
      currentAssistant: defaultAssistant,
      lastUsedAssistantId: defaultAssistant.id,
      defaultAssistantId: '',
      loading: true,

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
          currentAssistant:
            state.currentAssistant?.id === assistant.id
              ? assistant
              : state.currentAssistant,
        })
        getServiceHub()
          .assistants()
          .createAssistant(assistant as unknown as CoreAssistant)
          .catch((error) => {
            console.error('Failed to update assistant:', error)
          })
      },

      deleteAssistant: (id) => {
        const state = get()
        getServiceHub()
          .assistants()
          .deleteAssistant(
            state.assistants.find((e) => e.id === id) as unknown as CoreAssistant
          )
          .catch((error) => {
            console.error('Failed to delete assistant:', error)
          })

        const wasCurrentAssistant = state.currentAssistant?.id === id
        const wasDefaultAssistant = state.defaultAssistantId === id

        const remainingAssistants = state.assistants.filter((a) => a.id !== id)
        const fallback = remainingAssistants.find(
          (a) => a.id === defaultAssistant.id
        )

        const update: Partial<AssistantState> = {
          assistants: remainingAssistants,
        }

        if (wasCurrentAssistant) {
          update.currentAssistant = fallback
          update.lastUsedAssistantId = defaultAssistant.id
        }

        if (wasDefaultAssistant) {
          update.defaultAssistantId = defaultAssistant.id
        }

        set(update)
      },

      setDefaultAssistant: (id) => {
        const newAssistant = get().assistants?.find((a) => a.id === id)
        if (newAssistant) {
          set({
            defaultAssistantId: id,
            currentAssistant: newAssistant,
            lastUsedAssistantId: id,
          })
        } else {
          set({ defaultAssistantId: id })
        }
      },

      setCurrentAssistant: (assistant, saveToStorage = true) => {
        const { currentAssistant, defaultAssistantId } = get()
        if (defaultAssistantId && currentAssistant?.id === defaultAssistantId) return
        if (currentAssistant === assistant) return

        const update: Partial<AssistantState> = { currentAssistant: assistant }
        if (saveToStorage) {
          update.lastUsedAssistantId = assistant?.id || ''
        }
        set(update)
      },

      setAssistants: (assistants) => {
        if (!assistants) {
          set({ loading: false })
          return
        }

        // Ensure IDs are plain strings, not String objects
        assistants.forEach((a) => (a.id = a.id?.toString()))

        const { lastUsedAssistantId, defaultAssistantId } = get()
        set({
          assistants,
          currentAssistant: resolveCurrentAssistant(
            assistants,
            lastUsedAssistantId,
            defaultAssistantId
          ),
          loading: false,
        })
      },
    }),
    {
      name: localStorageKey.lastUsedAssistant,
      storage: createJSONStorage(() => fileStorage),
      // Only persist the preference IDs — runtime state like the assistants
      // list and currentAssistant are rebuilt on each session
      partialize: (state) => ({
        lastUsedAssistantId: state.lastUsedAssistantId,
        defaultAssistantId: state.defaultAssistantId,
      }),
      onRehydrateStorage: () => (rehydratedState) => {
        if (!rehydratedState) return

        const { assistants, lastUsedAssistantId, defaultAssistantId } =
          rehydratedState

        // If setAssistants hasn't run yet (only the placeholder default in
        // the list), there's nothing to re-select — setAssistants will pick
        // the right assistant once it runs with the hydrated IDs already set.
        if (
          assistants.length === 1 &&
          assistants[0].id === defaultAssistant.id
        ) {
          return
        }

        // Assistants were already loaded before hydration completed, so
        // re-resolve currentAssistant now that we have the real preferences.
        useAssistant.setState({
          currentAssistant: resolveCurrentAssistant(
            assistants,
            lastUsedAssistantId,
            defaultAssistantId
          ),
        })
      },
    }
  )
)
