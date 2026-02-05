import { useData } from 'nextra/data'
import CardDownload from './CardDownload'

const Download = () => {
  const { lastRelease } = useData()
  return (
    <div className="nextra-wrap-container py-20">
      <div className="text-center">
        <h1 className="text-6xl !font-normal leading-tight lg:leading-tight mt-2 font-serif">
          Download Jan for your desktop
        </h1>
        <p className="text-xl mt-2 leading-relaxed text-black/60 dark:text-white/60">
          Turn your computer into an AI computer
        </p>
        <div className="my-10">
          <CardDownload lastRelease={lastRelease} />
        </div>
        <div className="my-14">
          <a
            href="/docs"
            className="text-blue-600 dark:text-blue-400 cursor-pointer pr-4 border-r border-black/40 dark:border-white/40 mr-4 inline-block rounded-none"
          >
            Installation Guide
          </a>
          <a
            href="/changelog/"
            className="text-blue-600 dark:text-blue-400 cursor-pointer"
          >
            Changelog
          </a>
        </div>
      </div>
    </div>
  )
}

export default Download
