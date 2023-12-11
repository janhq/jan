import { Metadata } from 'next'

import Image from 'next/image'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Support - Jan.ai',
  description: 'Support',
}

const Page: React.FC = () => {
  return (
    <div className="scroll flex h-screen flex-col items-center overflow-y-auto pt-2 text-black">
      <div className="absolute left-5 top-3">
        <Link href="/" className="flex flex-row gap-2">
          <div className="flex items-center gap-0.5">
            <Image src={'icons/app_icon.svg'} width={28} height={28} alt="" />
            <Image src={'icons/Jan.svg'} width={27} height={12} alt="" />
          </div>
        </Link>
      </div>
      <article className="prose lg:prose-xl  my-20">
        <h1>Support </h1>
        <h3>Get fast support in our Discord channel</h3>
        <Link
          className="flex cursor-pointer gap-2"
          href={process.env.NEXT_PUBLIC_DISCORD_INVITATION_URL ?? '#'}
          target="_blank_"
        >
          <Image src={'icons/discord.svg'} width={70} height={70} alt="" />
        </Link>
        <p>
          If you have any questions or concerns about our privacy policy or
          support services, please contact us at{' '}
          <a href="mailto:hello@jan.ai">hello@jan.ai</a>.
        </p>
      </article>
    </div>
  )
}
export default Page
