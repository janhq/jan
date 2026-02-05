/**
 * Smart Collections Service
 * Dynamic project grouping with saved search filters
 */

import { ulid } from 'ulidx'
import { ThreadFolder } from '@/services/projects/types'

export interface SmartCollection {
  id: string
  name: string
  description?: string
  icon?: string
  color?: string
  pinned: boolean
  created_at: number
  query: CollectionQuery
}

export interface CollectionQuery {
  tags?: string[]
  priority?: ('low' | 'medium' | 'high')[]
  archived?: boolean
  starred?: boolean
  dateRange?: {
    from: Date
    to: Date
  }
  search?: string
}

const STORAGE_KEY = 'smart_collections'

export class SmartCollectionsService {
  private loadCollections(): SmartCollection[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      return data ? JSON.parse(data) : []
    } catch (error) {
      console.error('Failed to load smart collections:', error)
      return []
    }
  }

  private saveCollections(collections: SmartCollection[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collections))
    } catch (error) {
      console.error('Failed to save smart collections:', error)
    }
  }

  async getAllCollections(): Promise<SmartCollection[]> {
    return this.loadCollections()
  }

  async getCollectionById(id: string): Promise<SmartCollection | undefined> {
    const collections = this.loadCollections()
    return collections.find((c) => c.id === id)
  }

  async createCollection(
    name: string,
    query: CollectionQuery,
    options?: {
      description?: string
      icon?: string
      color?: string
      pinned?: boolean
    }
  ): Promise<SmartCollection> {
    const collections = this.loadCollections()

    const newCollection: SmartCollection = {
      id: ulid(),
      name,
      description: options?.description,
      icon: options?.icon || '🔍',
      color: options?.color,
      pinned: options?.pinned || false,
      created_at: Date.now(),
      query,
    }

    collections.push(newCollection)
    this.saveCollections(collections)

    return newCollection
  }

  async updateCollection(
    id: string,
    updates: Partial<Omit<SmartCollection, 'id' | 'created_at'>>
  ): Promise<void> {
    const collections = this.loadCollections()
    const index = collections.findIndex((c) => c.id === id)

    if (index === -1) {
      throw new Error(`Collection with id "${id}" not found`)
    }

    collections[index] = { ...collections[index], ...updates }
    this.saveCollections(collections)
  }

  async deleteCollection(id: string): Promise<void> {
    const collections = this.loadCollections()
    const filtered = collections.filter((c) => c.id !== id)
    this.saveCollections(filtered)
  }

  async togglePin(id: string): Promise<void> {
    const collection = await this.getCollectionById(id)
    if (collection) {
      await this.updateCollection(id, { pinned: !collection.pinned })
    }
  }

  matchesQuery(project: ThreadFolder, query: CollectionQuery): boolean {
    // Tag matching
    if (query.tags && query.tags.length > 0) {
      const projectTags = project.metadata?.tags || []
      const hasMatchingTag = query.tags.some((tag) => projectTags.includes(tag))
      if (!hasMatchingTag) return false
    }

    // Priority matching
    if (query.priority && query.priority.length > 0) {
      const projectPriority = project.metadata?.priority || 'medium'
      if (!query.priority.includes(projectPriority)) return false
    }

    // Archived filter
    if (query.archived !== undefined) {
      const isArchived = project.metadata?.archived || false
      if (isArchived !== query.archived) return false
    }

    // Starred filter
    if (query.starred !== undefined) {
      const isStarred = project.metadata?.starred || false
      if (isStarred !== query.starred) return false
    }

    // Date range filter
    if (query.dateRange) {
      const projectDate = new Date(project.created_at)
      if (
        projectDate < query.dateRange.from ||
        projectDate > query.dateRange.to
      ) {
        return false
      }
    }

    // Search filter
    if (query.search) {
      const searchLower = query.search.toLowerCase()
      const nameMatch = project.name.toLowerCase().includes(searchLower)
      const descMatch = project.description?.toLowerCase().includes(searchLower)
      if (!nameMatch && !descMatch) return false
    }

    return true
  }

  async getProjectsInCollection(
    collectionId: string,
    allProjects: ThreadFolder[]
  ): Promise<ThreadFolder[]> {
    const collection = await this.getCollectionById(collectionId)
    if (!collection) return []

    return allProjects.filter((project) =>
      this.matchesQuery(project, collection.query)
    )
  }

  async getPinnedCollections(): Promise<SmartCollection[]> {
    const collections = this.loadCollections()
    return collections.filter((c) => c.pinned)
  }
}

export const smartCollectionsService = new SmartCollectionsService()
