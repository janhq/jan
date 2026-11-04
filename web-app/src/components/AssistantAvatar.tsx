import type { ReactNode } from 'react'
import { IconUser } from '@tabler/icons-react'
import { AvatarEmoji } from '@/containers/AvatarEmoji'

/** Keep emoji, image and fallback avatars in the same compact row slot. */
export function AssistantAvatar({ avatar }: { avatar?: ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center leading-none">
      {avatar ? (
        <AvatarEmoji
          avatar={avatar}
          imageClassName="size-4 object-contain"
          textClassName="text-sm leading-none"
        />
      ) : (
        <IconUser size={16} className="shrink-0 text-muted-foreground" />
      )}
    </span>
  )
}
