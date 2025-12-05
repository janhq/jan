import { Thread, ThreadMessage } from '@janhq/core'

/**
 * Convert thread messages to markdown format
 */
export const convertThreadToMarkdown = (
    thread: Thread,
    messages: ThreadMessage[]
): string => {
    let markdown = ''

    // Header
    markdown += `# ${thread.title || 'Untitled Conversation'}\n\n`
    markdown += `**Thread ID:** \`${thread.id}\`\n`

    // Only add created/updated if they exist
    if (thread.metadata?.createdAt) {
        const createdDate = new Date(thread.metadata.createdAt as string | number | Date)
        markdown += `**Created:** ${createdDate.toLocaleString()}\n`
    }
    if (thread.metadata?.updatedAt) {
        const updatedDate = new Date(thread.metadata.updatedAt as string | number | Date)
        markdown += `**Updated:** ${updatedDate.toLocaleString()}\n`
    }

    markdown += `\n---\n\n`

    // Sort messages by their order in the array (they should already be sorted)
    const sortedMessages = [...messages]

    // Convert each message
    sortedMessages.forEach((msg, index) => {
        // Determine role label
        let roleLabel = '💬 **Message**'
        if (msg.role === 'user') {
            roleLabel = '👤 **User**'
        } else if (msg.role === 'assistant') {
            roleLabel = '🤖 **Assistant**'
        } else if (msg.role === 'system') {
            roleLabel = '⚙️ **System**'
        }

        markdown += `## ${roleLabel}\n\n`

        // Handle different content types
        const content = extractMessageContent(msg.content)
        markdown += `${content}\n\n`

        // Add separator between messages (except after the last one)
        if (index < sortedMessages.length - 1) {
            markdown += `---\n\n`
        }
    })

    // Footer
    markdown += `\n---\n\n`
    markdown += `*Exported from Jan on ${new Date().toLocaleString()}*\n`

    return markdown
}

/**
 * Extract text content from various message content formats
 */
function extractMessageContent(content: any): string {
    // Handle string content
    if (typeof content === 'string') {
        return content
    }

    // Handle array content (like OpenAI format)
    if (Array.isArray(content)) {
        return content
            .map((item: any) => {
                if (typeof item === 'string') {
                    return item
                }
                if (item.type === 'text' && item.text) {
                    return item.text
                }
                if (item.type === 'image_url') {
                    return `[Image: ${item.image_url?.url || 'N/A'}]`
                }
                return ''
            })
            .filter(Boolean)
            .join('\n\n')
    }

    // Fallback to string conversion
    return String(content)
}

/**
 * Download thread as markdown file
 */
export const downloadThreadAsMarkdown = (
    thread: Thread,
    messages: ThreadMessage[]
): void => {
    try {
        // Convert to markdown
        const markdown = convertThreadToMarkdown(thread, messages)

        // Create safe filename
        const safeTitle = (thread.title || 'chat')
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()
            .substring(0, 50)

        const timestamp = new Date().getTime()
        const filename = `${safeTitle}_${timestamp}.md`

        // Create blob and download
        const blob = new Blob([markdown], {
            type: 'text/markdown;charset=utf-8'
        })
        const url = URL.createObjectURL(blob)

        // Create temporary link and trigger download
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.style.display = 'none'

        document.body.appendChild(link)
        link.click()

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
        }, 100)

        console.log(`✅ Chat exported successfully as: ${filename}`)
    } catch (error) {
        console.error('❌ Error exporting chat:', error)
        alert('Failed to export chat. Please try again.')
    }
}