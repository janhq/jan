import React from 'react'
import { format } from 'date-fns'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

type ChangelogHeaderProps = {
  title: string
  ogImage: string
  date: any
}

const ChangelogHeader = (props: ChangelogHeaderProps) => {
  const { title, ogImage, date } = props

  return (
    <div className="mt-6">
      <Link href="/changelog" className="flex items-center gap-x-2">
        <ArrowLeft size={18} />
        <span>Back to changelog</span>
      </Link>
      <div className="mt-10">
        <p className="mb-2 text-black/60 dark:text-white/60">
          {format(String(date), 'MMMM do, yyyy') || null}
        </p>
        <h6 className="text-4xl font-bold leading-normal">{title}</h6>
      </div>
      {ogImage && (
        <Image
          src={ogImage}
          alt={title}
          width={1200}
          height={630}
          className="mb-4 mt-6 rounded-lg"
        />
      )}
    </div>
  )
}

export default ChangelogHeader
