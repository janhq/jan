/**
 * Project Templates Service
 * Predefined project structures for quick-start
 */

import { ulid } from 'ulidx'
import { ThreadFolder } from '@/services/projects/types'

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  icon: string
  color: string
  category: 'work' | 'personal' | 'research' | 'creative' | 'other'
  metadata: {
    tags: string[]
    priority: 'low' | 'medium' | 'high'
  }
  defaultThreads?: {
    title: string
    instructions?: string
  }[]
}

const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'template-research',
    name: 'Research Project',
    description: 'Organize research papers, notes, and findings',
    icon: '🔬',
    color: 'blue',
    category: 'research',
    metadata: {
      tags: ['research', 'academic'],
      priority: 'high',
    },
    defaultThreads: [
      {
        title: 'Literature Review',
        instructions: 'Summarize key papers and findings',
      },
      { title: 'Methodology', instructions: 'Outline research methodology' },
      { title: 'Data Analysis', instructions: 'Analyze collected data' },
    ],
  },
  {
    id: 'template-coding',
    name: 'Coding Project',
    description: 'Software development project with documentation',
    icon: '💻',
    color: 'purple',
    category: 'work',
    metadata: {
      tags: ['development', 'coding'],
      priority: 'high',
    },
    defaultThreads: [
      {
        title: 'Architecture Planning',
        instructions: 'Design system architecture',
      },
      { title: 'Code Review', instructions: 'Review and discuss code changes' },
      { title: 'Bug Tracking', instructions: 'Track and fix bugs' },
      { title: 'Documentation', instructions: 'Write technical documentation' },
    ],
  },
  {
    id: 'template-creative',
    name: 'Creative Writing',
    description: 'Story development, character building, and worldbuilding',
    icon: '✍️',
    color: 'pink',
    category: 'creative',
    metadata: {
      tags: ['writing', 'creative'],
      priority: 'medium',
    },
    defaultThreads: [
      { title: 'Plot Outline', instructions: 'Develop main story arc' },
      {
        title: 'Character Development',
        instructions: 'Create character profiles',
      },
      { title: 'Worldbuilding', instructions: 'Build the story world' },
      { title: 'Dialogue Practice', instructions: 'Write and refine dialogue' },
    ],
  },
  {
    id: 'template-learning',
    name: 'Learning Journey',
    description: 'Track learning progress and knowledge acquisition',
    icon: '📚',
    color: 'green',
    category: 'personal',
    metadata: {
      tags: ['learning', 'education'],
      priority: 'medium',
    },
    defaultThreads: [
      { title: 'Concepts & Definitions', instructions: 'Define key concepts' },
      { title: 'Practice Problems', instructions: 'Work through exercises' },
      {
        title: 'Notes & Summaries',
        instructions: 'Summarize learning material',
      },
      {
        title: 'Questions',
        instructions: 'Track questions and clarifications',
      },
    ],
  },
  {
    id: 'template-business',
    name: 'Business Planning',
    description: 'Business strategy, analysis, and planning',
    icon: '💼',
    color: 'orange',
    category: 'work',
    metadata: {
      tags: ['business', 'strategy'],
      priority: 'high',
    },
    defaultThreads: [
      {
        title: 'Market Analysis',
        instructions: 'Analyze market trends and competition',
      },
      { title: 'Strategy Planning', instructions: 'Develop business strategy' },
      {
        title: 'Financial Planning',
        instructions: 'Create financial projections',
      },
      {
        title: 'Marketing Ideas',
        instructions: 'Brainstorm marketing campaigns',
      },
    ],
  },
  {
    id: 'template-personal',
    name: 'Personal Assistant',
    description: 'General-purpose personal productivity',
    icon: '📋',
    color: 'gray',
    category: 'personal',
    metadata: {
      tags: ['productivity', 'personal'],
      priority: 'medium',
    },
    defaultThreads: [
      {
        title: 'Daily Planning',
        instructions: 'Plan daily tasks and priorities',
      },
      {
        title: 'Ideas & Notes',
        instructions: 'Capture random thoughts and ideas',
      },
      {
        title: 'Goals & Habits',
        instructions: 'Track goals and habit formation',
      },
    ],
  },
]

const STORAGE_KEY = 'custom_project_templates'

export class ProjectTemplatesService {
  private loadCustomTemplates(): ProjectTemplate[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      return data ? JSON.parse(data) : []
    } catch (error) {
      console.error('Failed to load custom templates:', error)
      return []
    }
  }

  private saveCustomTemplates(templates: ProjectTemplate[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
    } catch (error) {
      console.error('Failed to save custom templates:', error)
    }
  }

  async getAllTemplates(): Promise<ProjectTemplate[]> {
    const custom = this.loadCustomTemplates()
    return [...BUILTIN_TEMPLATES, ...custom]
  }

  async getTemplatesByCategory(
    category: ProjectTemplate['category']
  ): Promise<ProjectTemplate[]> {
    const all = await this.getAllTemplates()
    return all.filter((t) => t.category === category)
  }

  async getTemplateById(id: string): Promise<ProjectTemplate | undefined> {
    const all = await this.getAllTemplates()
    return all.find((t) => t.id === id)
  }

  async createCustomTemplate(
    template: Omit<ProjectTemplate, 'id'>
  ): Promise<ProjectTemplate> {
    const custom = this.loadCustomTemplates()

    const newTemplate: ProjectTemplate = {
      ...template,
      id: ulid(),
    }

    custom.push(newTemplate)
    this.saveCustomTemplates(custom)

    return newTemplate
  }

  async deleteCustomTemplate(id: string): Promise<void> {
    // Cannot delete built-in templates
    if (BUILTIN_TEMPLATES.some((t) => t.id === id)) {
      throw new Error('Cannot delete built-in templates')
    }

    const custom = this.loadCustomTemplates()
    const filtered = custom.filter((t) => t.id !== id)
    this.saveCustomTemplates(filtered)
  }

  async instantiateTemplate(
    templateId: string,
    projectName?: string
  ): Promise<ThreadFolder> {
    const template = await this.getTemplateById(templateId)
    if (!template) {
      throw new Error(`Template with id "${templateId}" not found`)
    }

    const project: ThreadFolder = {
      id: ulid(),
      name: projectName || template.name,
      description: template.description,
      icon: template.icon,
      color: template.color,
      parent_id: null,
      path: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      metadata: {
        tags: template.metadata.tags,
        priority: template.metadata.priority,
        archived: false,
        starred: false,
      },
    }

    return project
  }
}

export const projectTemplatesService = new ProjectTemplatesService()
