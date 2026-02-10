import { useState } from 'react'
import { useForm } from 'react-hook-form'

type FooterLink = {
  name: string
  href: string
  comingSoon?: boolean
}

type FooterMenu = {
  title: string
  links: FooterLink[]
}

const FOOTER_MENUS: FooterMenu[] = [
  {
    title: 'Company',
    links: [
      // {
      //   name: 'Open Superintelligence',
      //   href: '/handbook/why/open-superintelligence',
      // },
      // { name: 'Handbook', href: '/handbook' },
      // { name: 'Community', href: 'https://discord.com/invite/FTk2MvZwJH' },
      { name: 'Careers', href: 'https://menlo.bamboohr.com/careers' },
      { name: 'Discord', href: 'https://discord.com/invite/FTk2MvZwJH' },
      { name: 'GitHub', href: 'https://github.com/janhq/jan' },
      { name: 'LinkedIn', href: 'https://www.linkedin.com/company/opensuperintelligence' },
      { name: 'X', href: 'https://x.com/jandotai' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { name: 'Blog', href: '/blog' },
      { name: 'Docs', href: '/docs' },
      { name: 'Changelog', href: '/changelog' },
      { name: 'API Reference', href: '/docs/desktop/api-server' },
      // { name: 'Jan Exam', href: '/', comingSoon: true },
    ],
  },
  // {
  //   title: 'Store',
  //   links: [
  //     { name: 'Model Store', href: '/', comingSoon: true },
  //     { name: 'MCP Store', href: '/', comingSoon: true },
  //   ],
  // },
]

export default function Footer() {
  const [formMessage, setFormMessage] = useState('')
  const { register, handleSubmit, reset } = useForm<{ email: string }>()

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
    <footer className="py-4 w-full">
      <div className="mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-8">
          {/* Jan Logo and Newsletter */}
          <div className="md:col-span-1 lg:col-span-2">
            <h2 className="text-[52px] font-bold mb-6">Jan</h2>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span>
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2.03057 6.80498C2.04526 6.62516 2.06803 6.44579 2.10662 6.26806L10.4642 11.2488C11.4104 11.8127 12.5896 11.8127 13.5358 11.2488L21.8934 6.26806C21.932 6.44579 21.9547 6.62516 21.9694 6.80498C22 7.17954 22 7.6343 22 8.16144L22 14C22 12.3431 20.6569 11 19 11C17.3431 11 16 12.3431 16 14C14.3432 14 13 15.3431 13 17C13 18.6561 14.3418 19.9987 15.9976 20H6.16136C5.63428 20 5.17951 20 4.80498 19.9694C4.40963 19.9371 4.01641 19.8658 3.63803 19.673C3.07355 19.3854 2.6146 18.9265 2.32698 18.362C2.13419 17.9836 2.06287 17.5904 2.03057 17.195C1.99997 16.8205 1.99999 16.3657 2 15.8386V8.16142C1.99999 7.63432 1.99997 7.17952 2.03057 6.80498Z"
                      fill="black"
                    />
                    <path
                      d="M20.362 4.32698C20.5139 4.40441 20.6583 4.49426 20.7936 4.59523L12.5119 9.53079C12.1965 9.71876 11.8035 9.71876 11.4881 9.53079L3.20637 4.59524C3.34175 4.49426 3.48607 4.40441 3.63803 4.32698C4.01641 4.13419 4.40963 4.06287 4.80498 4.03057C5.17953 3.99997 5.6343 3.99998 6.1614 4H17.8386C18.3657 3.99998 18.8205 3.99997 19.195 4.03057C19.5904 4.06287 19.9836 4.13419 20.362 4.32698Z"
                      fill="black"
                    />
                    <path
                      d="M19 13C19.5523 13 20 13.4477 20 14V16H22C22.5523 16 23 16.4477 23 17C23 17.5523 22.5523 18 22 18H20V20C20 20.5523 19.5523 21 19 21C18.4477 21 18 20.5523 18 20V18H16C15.4477 18 15 17.5523 15 17C15 16.4477 15.4477 16 16 16H18V14C18 13.4477 18.4477 13 19 13Z"
                      fill="black"
                    />
                  </svg>
                </span>
                <p className="text-base font-bold">
                  Subscribe to our newsletter
                </p>
              </div>
              <form onSubmit={handleSubmit(onSubmit)}>
                <div className="relative">
                  <input
                    type="email"
                    placeholder="Enter your email"
                    {...register('email', { required: true })}
                    className="flex-1 px-3 py-2 h-[56px] border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full rounded-xl text-base"
                  />
                  <div className="absolute top-1 right-1 h-full">
                    <button
                      type="submit"
                      className="bg-black text-white px-6 h-[calc(100%-8px)] text-base hover:bg-gray-800 rounded-lg font-medium"
                    >
                      Submit
                    </button>
                  </div>
                </div>
                {formMessage && (
                  <p className="mt-2 text-sm text-green-600">{formMessage}</p>
                )}
              </form>
            </div>
          </div>

          <div className="md:col-span-1"></div>

          {/* Menu Columns */}
          {FOOTER_MENUS.map((menu) => (
            <div key={menu.title} className="">
              <h3 className="text-base mb-4 font-bold">{menu.title}</h3>
              <ul className="space-y-2">
                {menu.links.map((link) => (
                  <li key={link.name}>
                    <a
                      href={link.href}
                      className="text-base text-gray-600 hover:text-gray-900"
                      target={link.name === 'Discord' ? '_blank' : undefined}
                      rel={
                        link.name === 'Discord'
                          ? 'noopener noreferrer'
                          : undefined
                      }
                    >
                      {link.name}
                      {link.comingSoon && (
                        <span className="text-xs ml-2 bg-gray-200 border border-gray-300 px-1 py-0.5 rounded-3xl">
                          Coming Soon
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  )
}
