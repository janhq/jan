import { localStoregeKey } from '@/constants/localStorage'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Assistant = {
  avatar?: string
  id: string
  name: string
  created_at: number
  description?: string
  instructions: string
  parameters: Record<string, unknown>
}

interface AssistantState {
  assistants: Assistant[]
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
}

const defaultAssistant: Assistant = {
  avatar: '',
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
      addAssistant: (assistant) =>
        set({ assistants: [...get().assistants, assistant] }),
      updateAssistant: (assistant) =>
        set({
          assistants: get().assistants.map((a) =>
            a.id === assistant.id ? assistant : a
          ),
        }),
      deleteAssistant: (id) =>
        set({ assistants: get().assistants.filter((a) => a.id !== id) }),
    }),
    {
      name: localStoregeKey.assistant,
    }
  )
)
