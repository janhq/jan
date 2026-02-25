import { useState, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandDiscord,
  IconArrowRight,
} from '@tabler/icons-react'

export type ChannelType = 'telegram' | 'whatsapp' | 'discord'

interface AddChannelDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSelectChannel: (channel: ChannelType) => void
  connectedChannels: ChannelType[]
}

interface ChannelOption {
  id: ChannelType
  name: string
  icon: React.ReactNode
  description: string
}

export function AddChannelDialog({
  isOpen,
  onOpenChange,
  onSelectChannel,
  connectedChannels,
}: AddChannelDialogProps) {
  const { t } = useTranslation()
  const [selectedChannel, setSelectedChannel] = useState<ChannelType | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setSelectedChannel(null)
    }
  }, [isOpen])

  const channelOptions: ChannelOption[] = [
    {
      id: 'telegram',
      name: t('settings:remoteAccess.telegram'),
      icon: <IconBrandTelegram size={32} className="text-blue-500" />,
      description: t('settings:remoteAccess.channelDescriptions.telegram'),
    },
    {
      id: 'whatsapp',
      name: t('settings:remoteAccess.whatsapp'),
      icon: <IconBrandWhatsapp size={32} className="text-green-500" />,
      description: t('settings:remoteAccess.channelDescriptions.whatsapp'),
    },
    {
      id: 'discord',
      name: t('settings:remoteAccess.discord'),
      icon: <IconBrandDiscord size={32} className="text-indigo-500" />,
      description: t('settings:remoteAccess.channelDescriptions.discord'),
    },
  ]

  const handleChannelSelect = (channel: ChannelType) => {
    setSelectedChannel(channel)
  }

  const handleContinue = () => {
    if (selectedChannel) {
      onSelectChannel(selectedChannel)
      onOpenChange(false)
    }
  }

  const handleOpenWizard = (channel: ChannelType) => {
    onSelectChannel(channel)
    onOpenChange(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>{t('settings:remoteAccess.addChannel.title')}</DialogTitle>
          <DialogDescription>
            {t('settings:remoteAccess.addChannel.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {channelOptions.map((channel) => {
            const isConnected = connectedChannels.includes(channel.id)
            return (
              <div
                key={channel.id}
                className={`relative flex items-center gap-4 p-4 rounded-lg border transition-all cursor-pointer ${
                  selectedChannel === channel.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-border hover:bg-secondary/50'
                }`}
                onClick={() => handleChannelSelect(channel.id)}
              >
                <div className="flex-shrink-0">{channel.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{channel.name}</span>
                    {isConnected && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500">
                        {t('settings:remoteAccess.connected')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {channel.description}
                  </p>
                </div>
                {isConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenWizard(channel.id)
                    }}
                  >
                    {t('settings:remoteAccess.manage')}
                  </Button>
                ) : (
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selectedChannel === channel.id
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground'
                    }`}
                  >
                    {selectedChannel === channel.id && (
                      <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('settings:remoteAccess.addChannel.cancel')}
          </Button>
          <Button
            onClick={handleContinue}
            disabled={!selectedChannel}
            className="gap-2"
          >
            {t('settings:remoteAccess.addChannel.continue')}
            <IconArrowRight size={16} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}