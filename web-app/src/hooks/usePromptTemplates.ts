import { create } from 'zustand'
import { PromptTemplate } from '@janhq/core'
import { DEFAULT_PROMPT_TEMPLATES } from '@/constants/defaultPromptTemplates'

interface PromptTemplateState {
  templates: Record<string, PromptTemplate>
  searchQuery: string
  selectedTemplate: PromptTemplate | null

  loadTemplates: () => Promise<void>
  addTemplate: (
    template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>
  updateTemplate: (
    id: string,
    updates: Partial<PromptTemplate>
  ) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  searchTemplates: (query: string) => PromptTemplate[]
  getTemplateByTrigger: (trigger: string) => PromptTemplate | undefined
  selectTemplate: (template: PromptTemplate | null) => void
  setSearchQuery: (query: string) => void
  initializeDefaults: () => Promise<void>
}

export const usePromptTemplates = create<PromptTemplateState>()((set, get) => ({
  templates: {},
  searchQuery: '',
  selectedTemplate: null,

  loadTemplates: async () => {
    try {
      const stored = localStorage.getItem('jan_prompt_templates')
      if (stored) {
        const templates = JSON.parse(stored)
        set({ templates })
      } else {
        await get().initializeDefaults()
      }
    } catch (error) {
      console.error('Failed to load templates:', error)
    }
  },

  initializeDefaults: async () => {
    const templates: Record<string, PromptTemplate> = {}

    DEFAULT_PROMPT_TEMPLATES.forEach((template, index) => {
      const id = `default_${index}`
      templates[id] = {
        ...template,
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    })

    set({ templates })
    localStorage.setItem('jan_prompt_templates', JSON.stringify(templates))
  },

  addTemplate: async (template) => {
    const id = `template_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const newTemplate: PromptTemplate = {
      ...template,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const templates = { ...get().templates, [id]: newTemplate }
    set({ templates })
    localStorage.setItem('jan_prompt_templates', JSON.stringify(templates))
  },

  updateTemplate: async (id, updates) => {
    const templates = { ...get().templates }
    if (templates[id]) {
      templates[id] = {
        ...templates[id],
        ...updates,
        updatedAt: Date.now(),
      }
      set({ templates })
      localStorage.setItem('jan_prompt_templates', JSON.stringify(templates))
    }
  },

  deleteTemplate: async (id) => {
    const templates = { ...get().templates }
    delete templates[id]
    set({ templates })
    localStorage.setItem('jan_prompt_templates', JSON.stringify(templates))
  },

  searchTemplates: (query) => {
    const { templates } = get()
    const lowerQuery = query.toLowerCase()

    return Object.values(templates).filter(
      (t) =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.trigger.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery)
    )
  },

  getTemplateByTrigger: (trigger) => {
    const { templates } = get()
    return Object.values(templates).find((t) => t.trigger === trigger)
  },

  selectTemplate: (template) => set({ selectedTemplate: template }),

  setSearchQuery: (query) => set({ searchQuery: query }),
}))
