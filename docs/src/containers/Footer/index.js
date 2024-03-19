import React, { useState } from 'react'

import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import { AiOutlineGithub, AiOutlineTwitter } from 'react-icons/ai'
import { BiLogoDiscordAlt, BiLogoLinkedin } from 'react-icons/bi'
import { useForm } from 'react-hook-form'

const socials = [
  {
    icon: (
      <AiOutlineTwitter className="text-xl text-black/60 dark:text-white/60" />
    ),
    href: 'https://twitter.com/janframework',
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
    icon: (
      <BiLogoLinkedin className="text-xl text-black/60 dark:text-white/60" />
    ),
    href: 'https://www.linkedin.com/company/janframework/',
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
        menu: 'Documentation',
        path: '/developer',
      },
      {
        menu: 'Changelog',
        path: 'https://github.com/janhq/jan/releases',
        external: true,
      },
    ],
  },
  {
    name: 'For Developers',
    child: [
      {
        menu: 'Guides',
        path: '/guides',
      },
      {
        menu: 'Developer',
        path: '/developer',
      },
      {
        menu: 'API Reference',
        path: '/api-reference',
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
        path: 'https://twitter.com/janframework',
        external: true,
      },
      {
        menu: 'LinkedIn',
        path: 'https://www.linkedin.com/company/janframework/',
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
        path: 'https://janai.bamboohr.com/careers',
        external: true,
      },
      {
        menu: 'Newsletter',
        path: '/community#newsletter',
      },
    ],
  },
]

const getCurrentYear = new Date().getFullYear()

export default function Footer() {
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      email: '',
    },
  })

  const {
    siteConfig: { customFields },
  } = useDocusaurusContext()

  const [formMessage, setFormMessage] = useState('')

  const onSubmit = (data) => {
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
    <footer className="flex-shrink-0 relative overflow-hidden py-10">
      <div className="container">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-2 lg:grid-cols-6">
          <div className="col-span-2">
            <div className="flex items-center space-x-2 mb-3">
              <img alt="Jan Logo" src="/img/logo.svg" />
              <h2 className="h5">Jan</h2>
            </div>
            <div className="w-full lg:w-3/4 mt-2">
              <h6>The Soul of a New Machine</h6>
              <p className="dark:text-gray-400 text-gray-600 mt-2">
                Subscribe to our newsletter on AI{' '}
                <br className="hidden lg:block" />
                research and building Jan:
              </p>

              <div className="mt-4">
                <form className="relative" onSubmit={handleSubmit(onSubmit)}>
                  <input
                    type="email"
                    className="w-full h-12 p-4 pr-14 rounded-xl border dark:border-gray-600 dark:bg-[#252525] border-[#F0F0F0]"
                    placeholder="Enter your email"
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
                <h2 className="mb-3 h6">{menu.name}</h2>
                <ul>
                  {menu.child.map((child, i) => {
                    return (
                      <li key={i}>
                        <a
                          href={child.path}
                          target={child.external ? '_blank' : '_self'}
                          className="inline-block py-1 dark:text-gray-400 text-gray-600"
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
      </div>
      <div className="container mt-8">
        <div className="flex w-full justify-between items-center">
          <span className="dark:text-gray-300 text-gray-700">
            &copy;{getCurrentYear}&nbsp;Jan AI Pte Ltd.
          </span>
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
        </div>
      </div>
    </footer>
  )
}
