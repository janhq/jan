import { useEffect, useState, useMemo } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  MessageCircleMore,
  History,
  MessageCirclePlus,
  TextSearch,
} from 'lucide-react'
import { useConversations } from '@/stores/conversation-store'
import { useProjects } from '@/stores/projects-store'
import { LOCAL_STORAGE_KEY, QUERY_LIMIT, URL_PARAM } from '@/constants'

interface SearchDialogProps {
  open: boolean
}

export function SearchDialog({ open }: SearchDialogProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const conversations = useConversations((state) => state.conversations)
  const getConversations = useConversations((state) => state.getConversations)
  const projects = useProjects((state) => state.projects)
  const getProjects = useProjects((state) => state.getProjects)

  // Load conversations and projects when dialog opens
  useEffect(() => {
    if (open) {
      getConversations()
      getProjects()
    }
  }, [open, getConversations, getProjects])

  // Load recent searches from localStorage
  const recentSearches = useMemo(() => {
    if (!open) return []

    const stored = localStorage.getItem(LOCAL_STORAGE_KEY.RECENT_SEARCHES)
    if (!stored) return []

    try {
      const conversationIds = JSON.parse(stored) as string[]
      return conversationIds
        .map((id) => conversations.find((conv) => conv.id === id))
        .filter((conv): conv is Conversation => conv !== undefined)
    } catch {
      return []
    }
  }, [open, conversations])

  const handleClose = () => {
    setSearchQuery('') // Reset search query when dialog closes
    const url = new URL(window.location.href)
    url.searchParams.delete(URL_PARAM.SEARCH)
    router.navigate({ to: url.pathname + url.search })
  }

  const handleSelectConversation = (conversationId: string) => {
    // Save to recent searches
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY.RECENT_SEARCHES)
    let conversationIds: string[] = []

    if (stored) {
      try {
        conversationIds = JSON.parse(stored) as string[]
      } catch {
        conversationIds = []
      }
    }

    // Remove if already exists and add to front
    conversationIds = conversationIds.filter((id) => id !== conversationId)
    conversationIds.unshift(conversationId)

    // Keep only QUERY_LIMIT.MAX_RECENT_SEARCHES
    conversationIds = conversationIds.slice(0, QUERY_LIMIT.MAX_RECENT_SEARCHES)

    localStorage.setItem(LOCAL_STORAGE_KEY.RECENT_SEARCHES, JSON.stringify(conversationIds))

    handleClose()
    router.navigate({ to: `/threads/${conversationId}` })
  }

  // Filter and group conversations based on search query
  const searchResults = useMemo(() => {
    if (!searchQuery) return { withProject: [], withoutProject: [] }

    const query = searchQuery.toLowerCase()
    const withProject: Array<{
      conversation: Conversation
      projectName: string
    }> = []
    const withoutProject: Conversation[] = []

    conversations.forEach((conversation) => {
      const titleMatch = conversation.title.toLowerCase().includes(query)

      // Get project name
      const projectName = conversation.project_id
        ? projects.find((p) => p.id === conversation.project_id)?.name
        : null

      const projectMatch = projectName?.toLowerCase().includes(query)

      if (titleMatch || projectMatch) {
        if (projectName) {
          withProject.push({ conversation, projectName })
        } else {
          withoutProject.push(conversation)
        }
      }
    })

    return { withProject, withoutProject }
  }, [searchQuery, conversations, projects])

  const showStartNewChat = !searchQuery

  const handleStartNewChat = () => {
    handleClose()
    router.navigate({ to: '/' })
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(isOpen) => !isOpen && handleClose()}
      title="Search"
      description="Search for conversations"
      className="min-h-80"
    >
      <CommandInput
        placeholder="Search for conversations"
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <TextSearch
              className="size-6 text-muted-foreground mb-4"
              strokeWidth={1.5}
            />
            <h3 className="text-base font-medium mb-1">No results found</h3>
            <p className="text-sm text-muted-foreground">
              Maybe check the spelling or try another search
            </p>
          </div>
        </CommandEmpty>

        {/* Start new chat - shown when no recent searches */}
        {showStartNewChat && (
          <CommandGroup>
            <CommandItem
              onSelect={handleStartNewChat}
              className="cursor-pointer"
            >
              <MessageCirclePlus className="size-3" />
              <span>Start new chat</span>
            </CommandItem>
          </CommandGroup>
        )}

        {/* Recent searches - shown when search is empty */}
        {!searchQuery && recentSearches.length > 0 && (
          <CommandGroup heading="Recent">
            {recentSearches.map((conversation) => (
              <CommandItem
                key={conversation.id}
                value={conversation.title}
                onSelect={() => handleSelectConversation(conversation.id)}
                className="cursor-pointer"
              >
                <History className="size-3" />
                <span>{conversation.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Search results with project name */}
        {searchQuery && searchResults.withProject.length > 0 && (
          <CommandGroup>
            {searchResults.withProject.map(({ conversation, projectName }) => (
              <CommandItem
                key={conversation.id}
                value={`${conversation.title} ${projectName}`}
                onSelect={() => handleSelectConversation(conversation.id)}
                className="cursor-pointer"
              >
                <MessageCircleMore className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {projectName}
                  </span>
                  <span>{conversation.title}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Search results without project name */}
        {searchQuery && searchResults.withoutProject.length > 0 && (
          <CommandGroup>
            {searchResults.withoutProject.map((conversation) => (
              <CommandItem
                key={conversation.id}
                value={conversation.title}
                onSelect={() => handleSelectConversation(conversation.id)}
                className="cursor-pointer"
              >
                <MessageCircleMore className="mr-2 h-4 w-4" />
                <span>{conversation.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
