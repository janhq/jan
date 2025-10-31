import * as React from 'react'
import { Button } from './button'
import { cn } from '@/lib/utils'
import { FaApple, FaWindows, FaLinux } from 'react-icons/fa'
import { formatFileSize } from '@/utils/format'

interface DownloadOption {
  id: string
  name: string
  icon: React.ReactNode
  size: string
  href: string
  isActive?: boolean
}

const downloadOptionsTemplate: DownloadOption[] = [
  {
    id: 'mac',
    name: 'Download for Mac',
    icon: <FaApple className="size-5" />,
    size: '',
    href: '#',
    isActive: true,
  },
  {
    id: 'windows',
    name: 'Download for Windows',
    icon: <FaWindows className="size-5" />,
    size: '',
    href: '#',
  },
  {
    id: 'linux-appimage',
    name: 'Download for Linux (AppImage)',
    icon: <FaLinux className="size-5" />,
    size: '',
    href: '#',
  },
  {
    id: 'linux-deb',
    name: 'Download for Linux (Deb)',
    icon: <FaLinux className="size-5" />,
    size: '',
    href: '#',
  },
]

const fileFormatMap: { [key: string]: string } = {
  'mac': 'Jan_{tag}_universal.dmg',
  'windows': 'Jan_{tag}_x64-setup.exe',
  'linux-appimage': 'Jan_{tag}_amd64.AppImage',
  'linux-deb': 'Jan_{tag}_amd64.deb',
}

interface DropdownButtonProps {
  size?: 'default' | 'sm' | 'lg' | 'xl' | 'icon' | 'xxl'
  className?: string
  classNameButton?: string
  lastRelease?: any
}

export function DropdownButton({
  size = 'xl',
  className,
  classNameButton,
  lastRelease,
}: DropdownButtonProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [downloadOptions, setDownloadOptions] = React.useState(
    downloadOptionsTemplate
  )
  const [currentOption, setCurrentOption] = React.useState(
    downloadOptions.find((opt) => opt.isActive) || downloadOptions[0]
  )
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const toggleDropdown = () => setIsOpen(!isOpen)

  const selectOption = (option: DownloadOption) => {
    setCurrentOption(option)
    setIsOpen(false)
  }

  const changeDefaultSystem = React.useCallback((systems: DownloadOption[]) => {
    const userAgent = navigator.userAgent
    if (userAgent.includes('Windows')) {
      // windows user
      const windowsOption = systems.find((opt) => opt.id === 'windows')
      if (windowsOption) setCurrentOption(windowsOption)
    } else if (userAgent.includes('Linux')) {
      // linux user - prefer deb package
      const linuxOption = systems.find((opt) => opt.id === 'linux-deb')
      if (linuxOption) setCurrentOption(linuxOption)
    } else if (userAgent.includes('Mac OS')) {
      // mac user - always use universal build
      const macOption = systems.find((opt) => opt.id === 'mac')
      if (macOption) setCurrentOption(macOption)
    } else {
      // fallback to windows
      const windowsOption = systems.find((opt) => opt.id === 'windows')
      if (windowsOption) setCurrentOption(windowsOption)
    }
  }, [])

  React.useEffect(() => {
    if (lastRelease) {
      try {
        const tag = lastRelease.tag_name.startsWith('v')
          ? lastRelease.tag_name.substring(1)
          : lastRelease.tag_name

        const updatedOptions = downloadOptionsTemplate.map((option) => {
          const fileFormat = fileFormatMap[option.id]
          const fileName = fileFormat.replace('{tag}', tag)

          // Find the corresponding asset to get the file size
          const asset = lastRelease.assets.find(
            (asset: any) => asset.name === fileName
          )

          return {
            ...option,
            href: `https://github.com/janhq/jan/releases/download/${lastRelease.tag_name}/${fileName}`,
            size: asset ? formatFileSize(asset.size) : 'N/A',
          }
        })

        setDownloadOptions(updatedOptions)
        changeDefaultSystem(updatedOptions)
      } catch (error) {
        console.error('Failed to update download links:', error)
      }
    }
  }, [lastRelease, changeDefaultSystem])

  React.useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey)
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex w-full group hover:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] hover:bg-[#6BD689] shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] rounded-2xl transition-all border-2 border-black bg-[#7EF19D]',
          classNameButton?.includes('!shadow-none') &&
            '!shadow-none hover:!shadow-none !translate-y-0 hover:!translate-y-0',
          className
        )}
      >
        {/* Main Button */}
        <Button
          size={size}
          variant="ghost"
          className={cn(
            '!rounded-r-none !border-0 flex-1 !shadow-none group-hover:!shadow-none !transform-none group-hover:!transform-none !bg-transparent hover:!bg-transparent text-black',
            classNameButton
          )}
          asChild
        >
          <a
            href={currentOption.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {currentOption.icon}
            <span className="flex flex-col">
              <span>{currentOption.name}</span>
            </span>
          </a>
        </Button>

        {/* Dropdown Toggle */}
        <Button
          size={size}
          variant="ghost"
          className={cn(
            '!rounded-l-none px-3 !border-0 flex-shrink-0 !shadow-none group-hover:!shadow-none !transform-none group-hover:!transform-none !bg-transparent hover:!bg-transparent text-black border-l border-black',
            classNameButton
          )}
          onClick={toggleDropdown}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-chevrons-up-down-icon lucide-chevrons-up-down"
          >
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </svg>
        </Button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-full lg:w-[400px] bg-white rounded-[20px] overflow-hidden shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border-2 border-black z-40">
          <div className="m-1 overflow-hidden">
            {downloadOptions.map((option) => (
              <a
                key={option.id}
                href={option.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 text-left hover:text-[#0668D5] hover:bg-[#E0EEFE] rounded-2xl transition-all'
                )}
                onClick={() => {
                  selectOption(option)
                  setIsOpen(false)
                }}
              >
                <div className="flex items-center gap-3">
                  {option.icon}
                  <span className="font-medium text-base tracking-[-0.16px]">
                    {option.name}
                  </span>
                </div>
                <span className="text-sm font-bold">{option.size}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
