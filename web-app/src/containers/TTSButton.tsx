import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { IconPlayerStop, IconVolume3 } from '@tabler/icons-react'
import { useTranslation } from '@/i18n'
import { useState } from 'react'
import * as tts from '@/lib/tts'

export const TTSButton = ({ text }: { text: string }) => {
    const [isPlaying, setIsPlaying] = useState(false)
  const { t } = useTranslation()

  const handleTTS = () => {
    if (!text) return

    if (isPlaying || tts.isSpeaking()) {
      tts.stop()
      setIsPlaying(false)
      return
    }

    setIsPlaying(true)
    // Use default options for now; caller may extend later
    tts.speak(text).then(() => setIsPlaying(false)).catch(() => setIsPlaying(false))
  }

  return (
    <button
      className="flex items-center gap-1 hover:text-accent transition-colors group relative cursor-pointer"
      onClick={handleTTS}
    >
      {isPlaying ? (
        <>
          <IconPlayerStop size={16} className="text-accent" />
        </>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconVolume3 size={16} />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('TTS')}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </button>
  )
}