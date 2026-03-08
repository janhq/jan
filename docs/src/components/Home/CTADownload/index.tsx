import DropdownDownload from '@/components/DropdownDownload'
import { totalDownload } from '@/utils/format'
import { useData } from 'nextra/data'

const CTADownload = () => {
  const { lastRelease, release } = useData()

  return (
    <div className="relative py-8">
      <div className="nextra-wrap-container">
        <div className="flex p-4 lg:justify-between flex-col lg:flex-row">
          <div className="w-full">
            <h1 className="text-5xl lg:text-7xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
              Turn your computer <br className="hidden lg:block" /> into an AI
              computer
            </h1>
          </div>
          <div className="lg:mt-10 w-full lg:w-1/2 mx-auto lg:mr-auto lg:text-right">
            <div className="my-4">
              <DropdownDownload lastRelease={lastRelease} />
            </div>
            <p className="mt-6 text-zinc-text-black/60 dark:text-white/60">
              {totalDownload(release)}+ Downloads | Free & Open Source
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CTADownload
