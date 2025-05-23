import { localStorageKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (assistant: Assistant) => void
}

export const defaultAssistant: Assistant = {
  avatar: '👋',
  id: 'jan',
  name: 'Jan',
  created_at: 1747029866.542,
  description: 'A default assistant that can use all downloaded models.',
  instructions: '',
  parameters: {},
}

export const useAssistant = create<AssistantState>()(
  persist(
    (set, get) => ({
      assistants: [defaultAssistant],
      currentAssistant: defaultAssistant,
      addAssistant: (assistant) =>
        set({ assistants: [...get().assistants, assistant] }),
      updateAssistant: (assistant) => {
        const state = get()
        set({
          assistants: state.assistants.map((a) =>
            a.id === assistant.id ? assistant : a
          ),
          // Update currentAssistant if it's the same assistant being updated
          currentAssistant:
            state.currentAssistant.id === assistant.id
              ? assistant
              : state.currentAssistant,
        })
      },
      deleteAssistant: (id) =>
        set({ assistants: get().assistants.filter((a) => a.id !== id) }),
      setCurrentAssistant: (assistant) => {
        set({ currentAssistant: assistant })
      },
    }),
    {
      name: localStorageKey.assistant,
    }
  )
)
