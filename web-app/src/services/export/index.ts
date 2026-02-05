/**
 * Project Export Service
 * Supports multiple export formats: JSON, Markdown, PDF, CSV
 */

import { ThreadFolder } from '@/services/projects/types'
import { Thread, ThreadContent } from '@janhq/core'

export interface ExportOptions {
  format: 'json' | 'markdown' | 'pdf' | 'csv'
  includeMetadata?: boolean
  includeMessages?: boolean
  includeSettings?: boolean
  dateRange?: {
    from: Date
    to: Date
  }
}

interface ExportMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: ThreadContent[]
  created_at: number
}

export class ProjectExportService {
  async exportProject(
    project: ThreadFolder,
    threads: Thread[],
    messages: ExportMessage[],
    options: ExportOptions
  ): Promise<Blob> {
    switch (options.format) {
      case 'json':
        return this.exportAsJSON(project, threads, messages, options)
      case 'markdown':
        return this.exportAsMarkdown(project, threads, messages, options)
      case 'csv':
        return this.exportAsCSV(project, threads, messages, options)
      case 'pdf':
        throw new Error(
          'PDF export not yet implemented - requires additional dependencies'
        )
      default:
        throw new Error(`Unsupported export format: ${options.format}`)
    }
  }

  private exportAsJSON(
    project: ThreadFolder,
    threads: Thread[],
    messages: ExportMessage[],
    options: ExportOptions
  ): Blob {
    const data: any = {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        color: project.color,
        icon: project.icon,
        created_at: project.created_at,
        updated_at: project.updated_at,
      },
    }

    if (options.includeMetadata && project.metadata) {
      data.project.metadata = project.metadata
    }

    if (options.includeMessages) {
      data.threads = threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        created_at: thread.created,
        updated_at: thread.updated,
        messages: messages
          .filter((m) => m.thread_id === thread.id)
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            created_at: m.created_at,
          })),
      }))
    }

    const json = JSON.stringify(data, null, 2)
    return new Blob([json], { type: 'application/json' })
  }

  private exportAsMarkdown(
    project: ThreadFolder,
    threads: Thread[],
    messages: ExportMessage[],
    options: ExportOptions
  ): Blob {
    let markdown = `# ${project.name}\n\n`

    if (project.description) {
      markdown += `${project.description}\n\n`
    }

    if (options.includeMetadata) {
      markdown += `## Metadata\n\n`
      markdown += `- **Created:** ${new Date(project.created_at).toLocaleString()}\n`
      markdown += `- **Updated:** ${new Date(project.updated_at).toLocaleString()}\n`

      if (project.metadata?.tags && project.metadata.tags.length > 0) {
        markdown += `- **Tags:** ${project.metadata.tags.join(', ')}\n`
      }

      if (project.metadata?.priority) {
        markdown += `- **Priority:** ${project.metadata.priority}\n`
      }

      markdown += `\n`
    }

    if (options.includeMessages) {
      markdown += `## Threads (${threads.length})\n\n`

      threads.forEach((thread) => {
        markdown += `### ${thread.title || 'Untitled Thread'}\n\n`
        markdown += `*Created: ${new Date(thread.created).toLocaleString()}*\n\n`

        const threadMessages = messages.filter((m) => m.thread_id === thread.id)

        threadMessages.forEach((msg) => {
          const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant'
          markdown += `#### ${role}\n\n`

          if (typeof msg.content === 'string') {
            markdown += `${msg.content}\n\n`
          } else {
            markdown += `${JSON.stringify(msg.content)}\n\n`
          }

          markdown += `---\n\n`
        })
      })
    }

    return new Blob([markdown], { type: 'text/markdown' })
  }

  private exportAsCSV(
    _project: ThreadFolder,
    threads: Thread[],
    messages: ExportMessage[],
    _options: ExportOptions
  ): Blob {
    let csv = 'Thread ID,Thread Title,Message Role,Message Content,Created At\n'

    threads.forEach((thread) => {
      const threadMessages = messages.filter((m) => m.thread_id === thread.id)

      threadMessages.forEach((msg) => {
        const contentText = msg.content
          .map((c) => c.text?.value || JSON.stringify(c))
          .join(' ')
          .replace(/"/g, '""') // Escape quotes

        csv += `"${thread.id}","${thread.title || 'Untitled'}","${msg.role}","${contentText}","${new Date(msg.created_at).toISOString()}"\n`
      })
    })

    return new Blob([csv], { type: 'text/csv' })
  }

  downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async exportProjectToFile(
    project: ThreadFolder,
    threads: Thread[],
    messages: ExportMessage[],
    options: ExportOptions
  ): Promise<void> {
    const blob = await this.exportProject(project, threads, messages, options)

    const extensions = {
      json: 'json',
      markdown: 'md',
      csv: 'csv',
      pdf: 'pdf',
    }

    const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}_export_${Date.now()}.${extensions[options.format]}`

    this.downloadBlob(blob, filename)
  }
}

export const projectExportService = new ProjectExportService()
