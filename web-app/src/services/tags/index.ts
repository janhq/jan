/**
 * Tags Service for managing project tags
 * Supports CRUD operations and tag assignment to projects
 */

import { ulid } from 'ulidx'

export interface Tag {
  id: string
  name: string
  color: string
  icon?: string
  created_at: number
}

const STORAGE_KEY = 'project_tags'

export class TagsService {
  private loadTags(): Tag[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      return data ? JSON.parse(data) : []
    } catch (error) {
      console.error('Failed to load tags:', error)
      return []
    }
  }

  private saveTags(tags: Tag[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tags))
    } catch (error) {
      console.error('Failed to save tags:', error)
    }
  }

  async getAllTags(): Promise<Tag[]> {
    return this.loadTags()
  }

  async getTagById(id: string): Promise<Tag | undefined> {
    const tags = this.loadTags()
    return tags.find((tag) => tag.id === id)
  }

  async getTagsByIds(ids: string[]): Promise<Tag[]> {
    const tags = this.loadTags()
    return tags.filter((tag) => ids.includes(tag.id))
  }

  async createTag(name: string, color: string, icon?: string): Promise<Tag> {
    const tags = this.loadTags()

    // Check if tag with same name exists
    const existing = tags.find(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    )
    if (existing) {
      throw new Error(`Tag "${name}" already exists`)
    }

    const newTag: Tag = {
      id: ulid(),
      name,
      color,
      icon,
      created_at: Date.now(),
    }

    tags.push(newTag)
    this.saveTags(tags)

    return newTag
  }

  async updateTag(
    id: string,
    updates: Partial<Omit<Tag, 'id' | 'created_at'>>
  ): Promise<void> {
    const tags = this.loadTags()
    const index = tags.findIndex((t) => t.id === id)

    if (index === -1) {
      throw new Error(`Tag with id "${id}" not found`)
    }

    tags[index] = { ...tags[index], ...updates }
    this.saveTags(tags)
  }

  async deleteTag(id: string): Promise<void> {
    const tags = this.loadTags()
    const filtered = tags.filter((t) => t.id !== id)
    this.saveTags(filtered)
  }

  async searchTags(query: string): Promise<Tag[]> {
    const tags = this.loadTags()
    const lowerQuery = query.toLowerCase()

    return tags.filter((tag) => tag.name.toLowerCase().includes(lowerQuery))
  }

  async getTagUsageCount(tagId: string): Promise<number> {
    try {
      // Query projects from localStorage to count tag usage
      const projectsData = localStorage.getItem('thread_folders')
      if (!projectsData) return 0

      const projects = JSON.parse(projectsData) as Array<{
        metadata?: { tags?: string[] }
      }>

      // Find the tag name by ID
      const tag = await this.getTagById(tagId)
      if (!tag) return 0

      // Count how many projects use this tag
      return projects.filter((project) =>
        project.metadata?.tags?.includes(tag.name)
      ).length
    } catch (error) {
      console.error('Failed to get tag usage count:', error)
      return 0
    }
  }

  async getMostUsedTags(limit: number = 10): Promise<Tag[]> {
    try {
      const tags = this.loadTags()

      // Get usage count for each tag
      const tagsWithUsage = await Promise.all(
        tags.map(async (tag) => ({
          tag,
          usageCount: await this.getTagUsageCount(tag.id),
        }))
      )

      // Sort by usage count (descending) then by creation date (newest first)
      const sorted = tagsWithUsage.sort((a, b) => {
        if (b.usageCount !== a.usageCount) {
          return b.usageCount - a.usageCount
        }
        return b.tag.created_at - a.tag.created_at
      })

      return sorted.slice(0, limit).map((item) => item.tag)
    } catch (error) {
      console.error('Failed to get most used tags:', error)
      const tags = this.loadTags()
      return tags.slice(0, limit)
    }
  }
}

export const tagsService = new TagsService()
