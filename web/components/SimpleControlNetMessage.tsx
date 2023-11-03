import Link from 'next/link'

import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'

import JanImage from '../containers/JanImage'

import { displayDate } from '../utils/datetime'

type Props = {
  avatarUrl?: string
  senderName: string
  text: string
  createdAt: number
  imageUrls: string[]
}

const SimpleControlNetMessage: React.FC<Props> = ({
  avatarUrl = '',
  senderName,
  imageUrls,
  text,
  createdAt,
}) => {
  return (
    <div className="flex items-start gap-2">
      <img
        className="rounded-full"
        src={avatarUrl}
        width={32}
        height={32}
        alt=""
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-start gap-1">
          <div className="text-sm font-extrabold leading-[15.2px] text-[#1B1B1B]">
            {senderName}
          </div>
          <div className="ml-2 text-xs font-medium leading-[13.2px] text-gray-400">
            {displayDate(createdAt)}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <p className="whitespace-break-spaces text-sm font-normal leading-[20px] dark:text-[#d1d5db]">
            {text}
          </p>
          <JanImage
            imageUrl={imageUrls[0]}
            className="aspect-square w-72 rounded-lg"
          />
          <div className="flex w-full flex-row items-start justify-start gap-2">
            <Link
              href={imageUrls[0] || '#'}
              target="_blank_"
              className="flex items-center gap-1 rounded-xl bg-[#F3F4F6] px-2 py-1"
            >
              <ArrowDownTrayIcon width={16} height={16} />
              <span className="text-[14px] leading-[20px] text-[#111928]">
                Download
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SimpleControlNetMessage
