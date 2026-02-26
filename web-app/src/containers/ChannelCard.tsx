import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import {
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandDiscord,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'

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

interface ChannelCardProps {
  type: ChannelType
  config: ChannelConfig | null
  onSettings: () => void
  onDisconnect: () => void
  OCIsInstalled: boolean
}

export function ChannelCard({
  type,
  config,
  onSettings,
  onDisconnect,
  OCIsInstalled,
}: ChannelCardProps) {
  const { t } = useTranslation()

  const isConnected = config?.connected ?? false

  const getChannelIcon = () => {
    switch (type) {
      case 'telegram':
        return <IconBrandTelegram size={16} className="text-blue-500" />
      case 'whatsapp':
        return <IconBrandWhatsapp size={16} className="text-green-500" />
      case 'discord':
        return <IconBrandDiscord size={16} className="text-indigo-500" />
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

  return (
    <div
      className={cn("border rounded-lg overflow-hidden transition-all",
        isConnected
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-border bg-card'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-2 px-3">
        <div className="flex items-center gap-2">
          <div className="shrink-0">{getChannelIcon()}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                {getChannelName()}
              </span>
              <div
                className={cn("size-2 rounded-full", {
                  'bg-green-500': isConnected,
                  'bg-muted-foreground': !isConnected,
                })}
              />
              <span
                className={cn("text-xs", {
                  'text-green-500': isConnected,
                  'text-muted-foreground': !isConnected,
                })}   
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
          <Button variant="outline" size="sm" onClick={onSettings}>
            <IconSettings />
            {t('settings:remoteAccess.settings')}
          </Button>
          {isConnected && (
            <Button variant="ghost" size="sm" onClick={onDisconnect}>
              <IconTrash />
            </Button>
          )}
        </div>
      </div>

      {/* Not Connected State */}
      {!isConnected && OCIsInstalled && (
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