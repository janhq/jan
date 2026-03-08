import { useData } from 'nextra/data'
import { format } from 'date-fns'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { twMerge } from 'tailwind-merge'

const Blog = () => {
  const data = useData()
  const searchParams = useSearchParams()
  const search = searchParams?.get('category')
  const router = useRouter()

  const staticCategories = [
    {
      name: 'Building Jan',
      id: 'building-jan',
    },
    {
      name: 'Research',
      id: 'research',
    },
    {
      name: 'Guides',
      id: 'guides',
    },
  ]

  return (
    <div className="nextra-wrap-container">
      <div className="mt-14 text-center">
        <h1 className="text-6xl !fqont-normal leading-tight lg:leading-tight mt-2 font-serif">
          Blog
        </h1>
        <div className="text-black/60 dark:text-white/60">
          <p className="text-base mt-2 leading-relaxed">
            The latest updates from Jan. See&nbsp;
            <a
              href="/changelog"
              className="text-blue-600 dark:text-blue-400 cursor-pointer"
            >
              Changelog
            </a>
            &nbsp;for more product updates.
          </p>
        </div>

        <div className="mt-10">
          <ul className="flex lg:gap-4 gap-1 whitespace-nowrap overflow-auto lg:overflow-hidden lg:whitespace-normal justify-center">
            <li
              onClick={() => {
                router.push(`blog/`)
              }}
              className={twMerge(
                'cursor-pointer py-1 px-2 lg:px-3 rounded-full',
                search === null &&
                  'dark:bg-blue-400 bg-blue-500 font-medium text-white'
              )}
            >
              <p>All Categories</p>
            </li>
            {staticCategories.map((cat, i) => {
              return (
                <li
                  key={i}
                  onClick={() => {
                    router.push(`blog/?category=${cat.id}`)
                  }}
                  className={twMerge(
                    'cursor-pointer py-1 px-2 lg:px-3 rounded-full',
                    cat.id === search &&
                      'dark:bg-blue-400 bg-blue-500 font-medium text-white'
                  )}
                >
                  <p>{cat.name}</p>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="w-full lg:w-3/4 mx-auto text-left">
          <div className="mt-20">
            {data
              ?.filter((post: any) => {
                if (search) {
                  return post.categories?.includes(String(search))
                } else {
                  return post
                }
              })
              .map((post: any, i: number) => {
                return (
                  <div key={i} className="flex gap-8 items-start">
                    <div className="w-3/12 -mt-2">
                      <p className="text-black/60 dark:text-white/60 font-medium">
                        {format(post?.date, 'MMMM do, yyyy')}
                      </p>
                    </div>
                    <Link
                      href={post?.url}
                      className="border-l dark:nx-border-neutral-800 w-full cursor-pointer"
                    >
                      <div className="flex gap-8 items-start w-full">
                        <div className="w-2 h-2 relative -left-1 bg-blue-500 rounded-full flex-shrink-0" />
                        <div className="pb-14 w-full -mt-2">
                          <div className="w-full pb-4 px-8 rounded-lg flex flex-col lg:flex-row justify-between">
                            <div>
                              <h6 className="text-lg lg:text-2xl font-bold">
                                {post?.title}
                              </h6>
                              {post?.description && (
                                <p className="mt-2 text-medium">
                                  {post?.description}
                                </p>
                              )}
                              {post?.categories && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {post.categories.map(
                                    (category: string, idx: number) => (
                                      <span
                                        key={idx}
                                        className="px-2 py-1 text-xs rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                                      >
                                        {category.replaceAll('-', ' ')}
                                      </span>
                                    )
                                  )}
                                </div>
                              )}
                              {post?.author && (
                                <p className="mt-2 text-black/60 dark:text-white/60 text-medium">
                                  By {post?.author}
                                </p>
                              )}
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
    </div>
  )
}

export default Blog
