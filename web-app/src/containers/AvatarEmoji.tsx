import React, { memo } from 'react'

import { cn } from '@/lib/utils'

/**
 * Checks if an avatar is a custom image (starts with '/images/')
 */
const isCustomImageAvatar = (avatar: React.ReactNode): avatar is string => {
  return typeof avatar === 'string' && avatar.startsWith('/images/')
}

const isAtomicChatLogoPath = (src: string) =>
  src.includes('atomic-chat-logo') || src.includes('transparent-logo')

/**
 * Component for rendering assistant avatars with consistent styling
 */
interface AvatarEmojiProps {
  avatar?: React.ReactNode
  imageClassName?: string
  textClassName?: string
}

export const AvatarEmoji: React.FC<AvatarEmojiProps> = memo(({
  avatar,
  imageClassName = 'w-5 h-5 object-contain',
  textClassName = 'text-base',
}) => {
  if (!avatar) return null
  if (isCustomImageAvatar(avatar)) {
    return (
      <img
        src={avatar}
        alt="Custom avatar"
        className={cn(
          imageClassName,
          isAtomicChatLogoPath(avatar) && 'dark:brightness-0 dark:invert'
        )}
      />
    )
  }

  return <span className={textClassName}>{avatar}</span>
})
