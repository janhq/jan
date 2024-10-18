import { useData } from 'nextra/data'
import { format } from 'date-fns'
import { useRouter, useSearchParams } from 'next/navigation'

import Link from 'next/link'
import { Cards } from 'nextra/components'
import { twMerge } from 'tailwind-merge'

const Blog = () => {
  const blogPost = useData()
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
  ]

  return (
    <div className="nextra-wrap-container py-14">
      <div className="w-full mx-auto">
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
          <ul className="flex lg:gap-4 gap-1 whitespace-nowrap overflow-auto lg:overflow-hidden lg:whitespace-normal">
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

        <Cards num={4} className="mt-14 gap-8">
          {blogPost
            .filter((post: BlogPostsThumbnail) => {
              if (search) {
                return post.categories?.includes(String(search))
              } else {
                return post
              }
            })
            .map((post: BlogPostsThumbnail, i: number) => {
              return (
                <Link
                  href={String(post.url)}
                  key={i}
                  className="nextra-card nx-group nx-flex nx-flex-col nx-justify-start nx-overflow-hidden nx-rounded-xl nx-border nx-border-gray-200 nx-text-current nx-no-underline dark:nx-shadow-none hover:nx-shadow-gray-100 dark:hover:nx-shadow-none nx-shadow-gray-100 active:nx-shadow-sm active:nx-shadow-gray-200 nx-transition-all nx-duration-200 hover:nx-border-gray-300 nx-bg-transparent nx-shadow-sm dark:nx-border-neutral-800 hover:nx-shadow-md dark:hover:nx-border-neutral-700"
                >
                  <div
                    className={twMerge(
                      'min-h-40 border-b border-gray-200 dark:border-neutral-800',
                      i % 2 !== 0
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-500'
                        : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'
                    )}
                  >
                    <div className="flex w-full h-full items-center px-4 justify-center">
                      <div className="text-center">
                        {post.categories?.map((cat, i) => {
                          return (
                            <p
                              className="inline-flex capitalize text-xl font-bold text-white"
                              key={i}
                            >
                              {cat?.replaceAll('-', ' ')}
                            </p>
                          )
                        })}
                        <p className="font-medium text-white">
                          {format(String(post.date), 'MMMM do, yyyy')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-6">
                    <h6 className="text-lg line-clamp-1 font-bold">
                      {post.title}
                    </h6>
                    <p className="my-2 text-black/60 dark:text-white/60 line-clamp-2 leading-relaxed">
                      {post.description}
                    </p>
                    <p className="dark:text-blue-400 text-blue-600 line-clamp-2 font-medium">
                      Read more...
                    </p>
                  </div>
                </Link>
              )
            })}
        </Cards>
      </div>
    </div>
  )
}

export default Blog
