import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import {
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandDiscord,
  IconSettings,
  IconTrash,
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

interface ChannelCardProps {
  type: ChannelType
  config: ChannelConfig | null
  onSettings: () => void
  onDisconnect: () => void
}

export function ChannelCard({
  type,
  config,
  onSettings,
  onDisconnect,
}: ChannelCardProps) {
  const { t } = useTranslation()

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