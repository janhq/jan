import { format } from 'date-fns'

import { useData } from 'nextra/data'
import Image from 'next/image'
import Link from 'next/link'

const Changelog = () => {
  const data = useData()

  return (
    <div className="nextra-wrap-container">
      <div className="mt-14 text-center">
        <h1 className="text-6xl !font-semibold leading-tight lg:leading-tight mt-2 font-serif">
          Changelog
        </h1>
        <div className="text-black/60 dark:text-white/60">
          <p className="text-base mt-2 leading-relaxed">
            Latest release updates from the Jan team.
          </p>
        </div>
        <div className="w-full lg:w-3/4 mx-auto text-left">
          <div className="mt-20">
            {data?.map((log: Changelog, i: number) => {
              return (
                <div key={i} className="flex gap-8 items-start">
                  <div className="w-3/12 -mt-2">
                    <p className="text-black/60 dark:text-white/60 font-medium">
                      {format(log?.date, 'MMMM do, yyyy')}
                    </p>
                  </div>
                  <Link
                    href={`./changelog/${log?.url}`}
                    className="border-l dark:nx-border-neutral-800 w-full cursor-pointer"
                  >
                    <div className="flex gap-8 items-start w-full">
                      <div className="w-2 h-2 relative -left-1 bg-blue-500 rounded-full flex-shrink-0" />
                      <div className="pb-14 w-full -mt-2">
                        <div className="w-full pb-4 px-8 rounded-lg flex flex-col lg:flex-row justify-between">
                          <div>
                            {log?.ogImage && (
                              <Image
                                src={log?.ogImage}
                                alt={log?.title}
                                width={1200}
                                height={630}
                                className="mb-4 rounded-lg"
                              />
                            )}
                            <h6 className="text-lg lg:text-2xl font-bold">
                              {log?.title}
                            </h6>
                            {log?.description && (
                              <p className="mt-2 text-medium">
                                {log?.description}
                              </p>
                            )}
                            <p className="mt-2 text-black/60 dark:text-white/60 text-medium">
                              New release Jan App v{log?.version}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="text-center">
        <Link
          href="https://github.com/janhq/jan/releases"
          target="_blank"
          className="dark:nx-bg-neutral-900 dark:text-white bg-black text-white hover:text-white justify-center dark:border dark:border-neutral-800 flex-shrink-0 px-4 py-3 rounded-xl inline-flex items-center"
        >
          View Prior Updates
        </Link>
      </div>
    </div>
  )
}

export default Changelog
