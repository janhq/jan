import { useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import {
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandDiscord,
  IconSettings,
  IconTrash,
  IconChevronDown,
  IconChevronUp,
  IconMessage,
  IconClock,
} from '@tabler/icons-react'

export type ChannelType = 'telegram' | 'whatsapp' | 'discord'

// Channel configuration interfaces
export interface TelegramConfig {
  bot_token: string
  bot_username: string | null
  connected: boolean
  pairing_code: string | null
  paired_users: number
}

export interface WhatsAppConfig {
  account_id: string
  session_path: string
  connected: boolean
  phone_number: string | null
  qr_code: string | null
  contacts_count: number
}

export interface DiscordConfig {
  account_id: string
  bot_token: string
  bot_username: string | null
  bot_discriminator: string | null
  connected: boolean
  guilds_count: number
  channels_count: number
}

// Union type for all channel configs
export type ChannelConfig = TelegramConfig | WhatsAppConfig | DiscordConfig

interface MessagePreview {
  id: string
  sender: string
  content: string
  timestamp: Date
}

interface ChannelCardProps {
  type: ChannelType
  config: ChannelConfig | null
  onSettings: () => void
  onDisconnect: () => void
  recentMessages?: MessagePreview[]
}

export function ChannelCard({
  type,
  config,
  onSettings,
  onDisconnect,
  recentMessages = [],
}: ChannelCardProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  const isConnected = config?.connected ?? false

  const getChannelIcon = () => {
    switch (type) {
      case 'telegram':
        return <IconBrandTelegram size={24} className="text-blue-500" />
      case 'whatsapp':
        return <IconBrandWhatsapp size={24} className="text-green-500" />
      case 'discord':
        return <IconBrandDiscord size={24} className="text-indigo-500" />
    }
  }

  const getChannelName = (): string => {
    switch (type) {
      case 'telegram':
        return t('settings:remoteAccess.telegram')
      case 'whatsapp':
        return t('settings:remoteAccess.whatsapp')
      case 'discord':
        return t('settings:remoteAccess.discord')
    }
  }

  const getChannelDetails = (): string => {
    if (!config || !isConnected) return ''

    switch (type) {
      case 'telegram': {
        const tg = config as TelegramConfig
        return tg.bot_username ? `@${tg.bot_username}` : ''
      }
      case 'whatsapp': {
        const wa = config as WhatsAppConfig
        return wa.phone_number || ''
      }
      case 'discord': {
        const dc = config as DiscordConfig
        return dc.bot_username ? `${dc.bot_username}#${dc.bot_discriminator || ''}` : ''
      }
      default:
        return ''
    }
  }

  const getConnectedUsers = (): number => {
    if (!config || !isConnected) return 0

    switch (type) {
      case 'telegram':
        return (config as TelegramConfig).paired_users
      case 'whatsapp':
        return (config as WhatsAppConfig).contacts_count
      case 'discord':
        return (config as DiscordConfig).guilds_count
      default:
        return 0
    }
  }

  const formatTimeAgo = (date: Date): string => {
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
    if (minutes < 1) return t('settings:remoteAccess.justNow')
    if (minutes === 1) return `1 ${t('settings:remoteAccess.minuteAgo')}`
    if (minutes < 60)
      return `${minutes} ${t('settings:remoteAccess.minutesAgo')}`
    const hours = Math.floor(minutes / 60)
    if (hours === 1) return `1 ${t('settings:remoteAccess.hourAgo')}`
    return `${hours} ${t('settings:remoteAccess.hoursAgo')}`
  }

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all ${
        isConnected
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-border bg-card'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">{getChannelIcon()}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                {getChannelName()}
              </span>
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500' : 'bg-muted-foreground'
                }`}
              />
              <span
                className={`text-xs ${
                  isConnected ? 'text-green-500' : 'text-muted-foreground'
                }`}
              >
                {isConnected
                  ? t('settings:remoteAccess.connected')
                  : t('settings:remoteAccess.notConnected')}
              </span>
            </div>
            {isConnected && getChannelDetails() && (
              <p className="text-sm text-muted-foreground">
                {getChannelDetails()}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isConnected && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mr-2">
              <IconMessage size={14} />
              <span>
                {getConnectedUsers()}{' '}
                {t('settings:remoteAccess.users', { count: getConnectedUsers() })}
              </span>
            </div>
          )}
          {recentMessages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="gap-1"
            >
              {isExpanded ? (
                <IconChevronUp size={16} />
              ) : (
                <IconChevronDown size={16} />
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onSettings}>
            <IconSettings size={16} className="mr-1" />
            {t('settings:remoteAccess.settings')}
          </Button>
          {isConnected && (
            <Button variant="ghost" size="sm" onClick={onDisconnect}>
              <IconTrash size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded Message History */}
      {isExpanded && recentMessages.length > 0 && (
        <div className="border-t border-border/40 p-4 bg-background/50">
          <h4 className="text-sm font-medium text-foreground mb-3">
            {t('settings:remoteAccess.recentMessages')}
          </h4>
          <div className="space-y-2">
            {recentMessages.map((message) => (
              <div
                key={message.id}
                className="flex items-start gap-3 p-2 rounded hover:bg-secondary/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {message.sender}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <IconClock size={12} />
                      {formatTimeAgo(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {message.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Not Connected State */}
      {!isConnected && (
        <div className="border-t border-border/40 px-4 py-3 bg-muted/30">
          <p className="text-sm text-muted-foreground">
            {t('settings:remoteAccess.channelNotConnected', {
              channel: getChannelName(),
            })}
          </p>
        </div>
      )}
    </div>
  )
}