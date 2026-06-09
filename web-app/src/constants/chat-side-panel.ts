import {
  ClipboardCheck,
  Folder,
  Globe,
  MessageCirclePlus,
  Paperclip,
  SlidersHorizontal,
  Terminal,
  type LucideIcon,
} from 'lucide-react'

export type ChatSidePanelSection =
  | 'files'
  | 'context'
  | 'side-chat'
  | 'review'
  | 'terminal'
  | 'model'
  | 'browser'

export type ChatSidePanelSectionItem = {
  id: ChatSidePanelSection
  label: string
  shortcut?: string
  icon: LucideIcon
}

export const CHAT_SIDE_PANEL_SECTIONS: ChatSidePanelSectionItem[] = [
  { id: 'files', label: 'Files', shortcut: '⌘P', icon: Folder },
  { id: 'context', label: 'Context', icon: Paperclip },
  { id: 'side-chat', label: 'Side chat', icon: MessageCirclePlus },
  { id: 'review', label: 'Review', shortcut: '^⇧G', icon: ClipboardCheck },
  { id: 'terminal', label: 'Terminal', shortcut: '^`', icon: Terminal },
  { id: 'model', label: 'Model tools', icon: SlidersHorizontal },
  { id: 'browser', label: 'Browser', icon: Globe },
]

export const CHAT_SIDE_PANEL_DROPDOWN_SECTIONS: ChatSidePanelSectionItem[] =
  CHAT_SIDE_PANEL_SECTIONS.filter((section) =>
    !['files', 'model'].includes(section.id)
  )

export const CHAT_SIDE_PANEL_DEFAULT_WIDTH = '20rem'
export const CHAT_SIDE_PANEL_MIN_WIDTH = '16rem'
export const CHAT_SIDE_PANEL_MAX_WIDTH = '40rem'

export function getChatSidePanelSection(
  id: ChatSidePanelSection
): ChatSidePanelSectionItem {
  return (
    CHAT_SIDE_PANEL_SECTIONS.find((section) => section.id === id) ??
    CHAT_SIDE_PANEL_SECTIONS[0]
  )
}
