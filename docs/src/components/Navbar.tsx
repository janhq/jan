/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { cn } from '@/lib/utils'
import { FaDiscord, FaGithub } from 'react-icons/fa'
import { FiDownload } from 'react-icons/fi'
import { FaXTwitter, FaLinkedinIn } from 'react-icons/fa6'
import { Button } from './ui/button'
import LogoJanSVG from '@/assets/icons/logo-jan.svg'

const MENU_ITEMS = [
  { name: 'Docs', href: '/docs' },
  { name: 'Changelog', href: '/changelog' },
  { name: 'Blog', href: '/blog' },
  { name: 'Handbook', href: '/handbook' },
]

const Navbar = ({ noScroll }: { noScroll?: boolean }) => {
  const router = useRouter()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const currentPath = router.asPath

  const isLanding = currentPath === '/'

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > (isLanding ? 76 : 0))
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [isLanding])

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isMobileMenuOpen])

  return (
    <div
      className={cn(
        'h-[100px] w-full top-0 z-50 transition-all duration-300 border-b lg:px-6 left-0',
        isLanding ? 'fixed' : 'sticky !border-opacity-100 !top-0',
        isScrolled || noScroll
          ? 'bg-white text-black h-[60px] border-border'
          : 'bg-transparent text-white h-[60px] border-gray-100 border-opacity-10 top-4'
      )}
      id="navbar"
    >
      <div className="flex nextra-wrap-container w-full mx-auto h-full justify-between items-center">
        <div>
          <a href="/" className="flex items-center gap-2">
            <img src={LogoJanSVG.src} alt="Jan" className="w-6 h-6" />
            <span
              className={cn('text-xl font-bold', !isLanding && '!text-black')}
            >
              Jan
            </span>
          </a>
        </div>

        {/* Desktop Navigation */}
        <nav>
          <ul className="lg:flex space-x-8 hidden items-center">
            {MENU_ITEMS.map((item) => {
              const isActive = currentPath === item.href
              return (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className={cn(
                      'hover:opacity-70 transition-opacity',
                      !isLanding && '!text-black',
                      isActive && 'text-blue-600 font-semibold'
                    )}
                  >
                    {item.name}
                  </a>
                </li>
              )
            })}
            <li>
              <a
                href="https://github.com/janhq/jan/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  className={cn(
                    'text-base',
                    !isLanding &&
                      '!bg-black !text-white !hover:bg-black !hover:text-white',
                    isScrolled || noScroll
                      ? 'bg-black text-white hover:bg-black hover:text-white'
                      : 'bg-white text-black hover:bg-white hover:text-black'
                  )}
                >
                  Download Jan
                </Button>
              </a>
            </li>

            <li>
              <div className={cn('flex gap-4', !isLanding && '!text-black')}>
                <a
                  href="https://discord.com/invite/FTk2MvZwJH"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg flex items-center justify-center"
                >
                  <FaDiscord className="size-5" />
                </a>
                <a
                  href="https://twitter.com/jandotai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg flex items-center justify-center"
                >
                  <FaXTwitter className="size-5" />
                </a>
                <a
                  href="https://linkedin.com/company/opensuperintelligence"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg flex items-center justify-center"
                >
                  <FaLinkedinIn className="size-5" />
                </a>
                <a
                  href="https://github.com/janhq/jan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg flex items-center justify-center"
                >
                  <FaGithub className="size-5" />
                </a>
              </div>
            </li>
          </ul>
        </nav>

        {/* Mobile Download Button and Hamburger */}
        <div className="lg:hidden flex items-center gap-3">
          <a
            href="https://github.com/janhq/jan/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="sm"
              className={cn(
                !isLanding &&
                  '!bg-black !text-white !hover:bg-black !hover:text-white',
                isScrolled || noScroll
                  ? 'bg-black text-white hover:bg-gray-800'
                  : 'bg-white text-black hover:bg-gray-100'
              )}
            >
              Download
            </Button>
          </a>
          <button
            className="flex flex-col items-center justify-center w-8 h-8"
            onClick={toggleMobileMenu}
            aria-label="Toggle mobile menu"
          >
            <span
              className={cn(
                'block w-6 h-0.5 bg-current transition-all duration-300 transform',
                !isLanding && 'bg-black',
                isMobileMenuOpen ? 'rotate-45 translate-y-1.5' : ''
              )}
            />
            <span
              className={cn(
                'block w-6 h-0.5 bg-current transition-all duration-300 mt-1',
                !isLanding && 'bg-black',
                isMobileMenuOpen ? 'opacity-0' : ''
              )}
            />
            <span
              className={cn(
                'block w-6 h-0.5 bg-current transition-all duration-300 transform mt-1',
                !isLanding && 'bg-black',
                isMobileMenuOpen ? '-rotate-45 -translate-y-1.5' : ''
              )}
            />
          </button>
        </div>
      </div>

      {/* Mobile Menu - Modal Card */}
      {isMobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Modal Card */}
          <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 lg:hidden max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              {/* Header with close button */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-black">Jan</h2>
                <button
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200"
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-label="Close menu"
                >
                  ×
                </button>
              </div>

              {/* Menu Items */}
              <nav className="mb-6">
                <ul className="space-y-4">
                  {MENU_ITEMS.map((item) => {
                    const isActive = currentPath === item.href
                    return (
                      <li key={item.name}>
                        <a
                          href={item.href}
                          className={cn(
                            'block text-lg font-medium text-black hover:text-gray-600 transition-colors py-2',
                            isActive && 'text-blue-600 font-bold'
                          )}
                          onClick={() => setIsMobileMenuOpen(false)}
                        >
                          {item.name}
                        </a>
                      </li>
                    )
                  })}
                  <li></li>
                </ul>
              </nav>

              {/* Social Icons */}
              <div className="flex gap-4 mb-6">
                <a
                  href="https://discord.com/invite/FTk2MvZwJH"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-black rounded-lg flex items-center justify-center"
                >
                  <FaDiscord className="size-5" />
                </a>
                <a
                  href="https://twitter.com/jandotai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-black rounded-lg flex items-center justify-center"
                >
                  <FaXTwitter className="size-5" />
                </a>
                <a
                  href="https://linkedin.com/company/opensuperintelligence"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-black rounded-lg flex items-center justify-center"
                >
                  <FaLinkedinIn className="size-5" />
                </a>
                <a
                  href="https://github.com/janhq/jan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-black rounded-lg flex items-center justify-center"
                >
                  <FaGithub className="size-5" />
                </a>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <Button
                  variant="playful-green"
                  size="xl"
                  className="w-full lg:w-auto text-left justify-start"
                  asChild
                >
                  <a
                    href="https://github.com/janhq/jan/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FiDownload className="size-6 mr-2" />
                    Download Jan
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Navbar
