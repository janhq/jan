import React, { useEffect, useState } from 'react'
import ThemeImage from '@/components/ThemeImage'
import { AiOutlineGithub } from 'react-icons/ai'
import { RiTwitterXFill } from 'react-icons/ri'

import { BiLogoDiscordAlt } from 'react-icons/bi'
import { useForm } from 'react-hook-form'
import LogoMark from '@/components/LogoMark'
import { FaLinkedin } from 'react-icons/fa'
import posthog from 'posthog-js'

const socials = [
  {
    icon: (
      <RiTwitterXFill className="text-lg text-black/60 dark:text-white/60" />
    ),
    href: 'https://twitter.com/jandotai',
  },
  {
    icon: (
      <BiLogoDiscordAlt className="text-xl text-black/60 dark:text-white/60" />
    ),
    href: 'https://discord.com/invite/FTk2MvZwJH',
  },
  {
    icon: (
      <AiOutlineGithub className="text-lg text-black/60 dark:text-white/60" />
    ),
    href: 'https://github.com/janhq/jan',
  },
  {
    icon: <FaLinkedin className="text-lg text-black/60 dark:text-white/60" />,
    href: 'https://www.linkedin.com/company/homebrewltd',
  },
]

const menus = [
  {
    name: 'Product',
    child: [
      {
        menu: 'Download',
        path: '/download',
      },
      {
        menu: 'Changelog',
        path: '/changelog',
      },
    ],
  },
  {
    name: 'For Developers',
    child: [
      {
        menu: 'Documentation',
        path: '/docs',
      },
    ],
  },
  {
    name: 'Community',
    child: [
      {
        menu: 'Github',
        path: 'https://github.com/janhq/jan',
        external: true,
      },
      {
        menu: 'Discord',
        path: 'https://discord.gg/FTk2MvZwJH',
        external: true,
      },
      {
        menu: 'Twitter',
        path: 'https://twitter.com/jandotai',
        external: true,
      },
      {
        menu: 'LinkedIn',
        path: 'https://www.linkedin.com/company/homebrewltd',
        external: true,
      },
    ],
  },
  {
    name: 'Company',
    child: [
      {
        menu: 'About',
        path: '/about',
      },
      {
        menu: 'Blog',
        path: '/blog',
      },
      {
        menu: 'Careers',
        path: 'https://homebrew.bamboohr.com/careers',
        external: true,
      },
    ],
  },
]

const getCurrentYear = new Date().getFullYear()

export default function Footer() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      posthog.init(process.env.POSTHOG_KEY as string, {
        api_host: process.env.POSTHOG_HOST,
        disable_session_recording: true,
        person_profiles: 'always',
        persistence: 'localStorage',
      })

      posthog.capture('web_page_view', { timestamp: new Date() })
    }
  }, [])

  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      email: '',
    },
  })

  const [formMessage, setFormMessage] = useState('')

  const onSubmit = (data: { email: string }) => {
    const { email } = data
    const options = {
      method: 'POST',

      body: JSON.stringify({
        updateEnabled: false,
        email,
        listIds: [13],
      }),
    }

    if (email) {
      fetch('https://brevo.jan.ai/', options)
        .then((response) => response.json())
        .then((response) => {
          if (response.id) {
            setFormMessage('You have successfully joined our newsletter')
          } else {
            setFormMessage(response.message)
          }
          reset()
          setTimeout(() => {
            setFormMessage('')
          }, 5000)
        })
        .catch((err) => console.error(err))
    }
  }

  return (
    <div className="flex-shrink-0 relative overflow-hidden w-full">
      <div className="grid grid-cols-2 gap-8 md:grid-cols-2 lg:grid-cols-6">
        <div className="col-span-2">
          <div className="flex items-center space-x-2 mb-3">
            <LogoMark />
            <h2 className="text-lg font-semibold dark:text-white text-black">
              Jan
            </h2>
          </div>
          <div className="w-full lg:w-3/4 mt-2">
            <h6 className="text-base text-black dark:text-white">
              The Soul of a New Machine
            </h6>
            <p className="dark:text-gray-400 text-gray-600 mt-2">
              Subscribe to our newsletter on AI&nbsp;
              <br className="hidden lg:block py-2 h-2 w-full" />
              research and building Jan:
            </p>

            <div className="mt-4">
              <form className="relative" onSubmit={handleSubmit(onSubmit)}>
                <input
                  type="email"
                  className="lg:ml-0.5 w-full h-12 p-4 pr-14 rounded-xl bg-white border dark:border-gray-600 dark:bg-[#252525] border-[#F0F0F0] focus-visible:ring-0"
                  placeholder="Enter your email"
                  autoComplete="off"
                  {...register('email')}
                />
                <button
                  type="submit"
                  className="absolute flex p-2 bg-black dark:bg-[#3B3B3C] w-8 h-8 border dark:border-gray-600 rounded-lg top-1/2 right-3 -translate-y-1/2"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M6.09026 8.41933L3.72077 7.62985C1.24061 6.80348 0 6.3903 0 5.63033C0 4.87142 1.24061 4.45718 3.72077 3.63081L12.6938 0.639442C14.4393 0.0576106 15.3121 -0.233305 15.7727 0.227312C16.2333 0.687928 15.9424 1.56068 15.3616 3.30512L12.3692 12.2792C11.5428 14.7594 11.1296 16 10.3697 16C9.61076 16 9.19652 14.7594 8.37015 12.2792L7.57962 9.9108L12.1689 5.3215C12.3609 5.1227 12.4672 4.85645 12.4648 4.58008C12.4624 4.30372 12.3515 4.03935 12.1561 3.84392C11.9607 3.64849 11.6963 3.53764 11.4199 3.53524C11.1435 3.53284 10.8773 3.63908 10.6785 3.83108L6.09026 8.41933Z"
                      fill="white"
                    />
                  </svg>
                </button>
              </form>
              {formMessage && <p className="text-left mt-4">{formMessage}</p>}
            </div>
          </div>
        </div>
        {menus.map((menu, i) => {
          return (
            <div key={i} className="lg:text-right">
              <h2 className="mb-2 font-bold dark:text-gray-300 text-black">
                {menu.name}
              </h2>
              <ul>
                {menu.child.map((child, i) => {
                  return (
                    <li key={i}>
                      <a
                        href={child.path}
                        target={child.external ? '_blank' : '_self'}
                        className="inline-block pt-3"
                      >
                        {child.menu}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      <div className="mt-10">
        <div className="flex w-full justify-between items-center flex-col md:flex-row gap-4">
          <div className="flex items-center gap-x-3">
            {socials.map((social, i) => {
              return (
                <a
                  aria-label={`social-${i}`}
                  key={i}
                  href={social.href}
                  target="_blank"
                  rel="noopener"
                >
                  {social.icon}
                </a>
              )
            })}
          </div>
          <span>&copy;{getCurrentYear}&nbsp;Homebrew Computer Company</span>
          <ThemeImage
            source={{
              light: '/assets/images/general/homebrew-dark.svg',
              dark: '/assets/images/general/homebrew-white.svg',
            }}
            alt="App screenshots"
            width={140}
            height={200}
          />
        </div>
      </div>
    </div>
  )
}
