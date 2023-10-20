import React from 'react'
import Link from 'next/link'
import Image from 'next/image'

const DiscordContainer = () => (
  <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-3">
    <Link
      className="flex items-center gap-2 rounded-lg text-xs font-semibold leading-[18px] text-purple-700"
      href={process.env.NEXT_PUBLIC_DISCORD_INVITATION_URL ?? '#'}
      target="_blank_"
    >
      <Image src={'icons/ico_Discord.svg'} width={20} height={20} alt="" />
      Discord
    </Link>
  </div>
)

export default React.memo(DiscordContainer)
