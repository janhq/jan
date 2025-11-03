import React, { useState, useEffect } from 'react'
import { IconType } from 'react-icons/lib'
import { FaWindows, FaApple, FaLinux } from 'react-icons/fa'
import { twMerge } from 'tailwind-merge'
import { DownloadIcon } from 'lucide-react'
import { formatFileSize } from '@/utils/format'

type Props = {
  lastRelease: any
}

type SystemType = {
  name: string
  label: string
  logo: IconType
  fileFormat: string
  href?: string
  size?: string
}

const systemsTemplate: SystemType[] = [
  {
    name: 'Mac ',
    label: 'Universal',
    logo: FaApple,
    fileFormat: 'Jan_{tag}_universal.dmg',
  },
  {
    name: 'Windows',
    label: 'Standard (64-bit)',
    logo: FaWindows,
    fileFormat: 'Jan_{tag}_x64-setup.exe',
  },
  {
    name: 'Linux (AppImage)',
    label: 'AppImage',
    logo: FaLinux,
    fileFormat: 'Jan_{tag}_amd64.AppImage',
  },
  {
    name: 'Linux (deb)',
    label: 'Deb',
    logo: FaLinux,
    fileFormat: 'Jan_{tag}_amd64.deb',
  },
]

const groupTemnplate = [
  { label: 'MacOS', name: 'mac', logo: FaApple },
  { label: 'Windows', name: 'windows', logo: FaWindows },
  { label: 'Linux', name: 'linux', logo: FaLinux },
]

export default function CardDownload({ lastRelease }: Props) {
  const [systems, setSystems] = useState(systemsTemplate)

  useEffect(() => {
    const updateDownloadLinks = async () => {
      try {
        // Remove 'v' at the start of the tag_name
        const tag = lastRelease.tag_name.startsWith('v')
          ? lastRelease.tag_name.substring(1)
          : lastRelease.tag_name

        const updatedSystems = systems.map((system) => {
          const downloadUrl = system.fileFormat.replace('{tag}', tag)

          // Find the corresponding asset to get the file size
          const asset = lastRelease.assets.find(
            (asset: any) => asset.name === downloadUrl
          )

          return {
            ...system,
            href: `https://github.com/janhq/jan/releases/download/${lastRelease.tag_name}/${downloadUrl}`,
            size: asset ? formatFileSize(asset.size) : undefined,
          }
        })

        setSystems(updatedSystems)
      } catch (error) {
        console.error('Failed to update download links:', error)
      }
    }

    updateDownloadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderDownloadLink = (group: string) => {
    return (
      <>
        {systems
          .filter((x) => x.name.toLowerCase().includes(group))
          .map((system, i) => (
            <div
              key={i}
              className="border-b border-[#F0F0F0] dark:border-gray-800 last:border-none pb-2 pt-2"
            >
              <a
                href={system.href || ''}
                className={twMerge(
                  'inline-flex text-lg my-2 font-semibold cursor-pointer justify-center items-center space-x-2] text-blue-500 hover:text-blue-500 gap-2'
                )}
              >
                <span>{system.label}</span>
                <DownloadIcon size={16} />
                {system.size && (
                  <div className="text-sm text-black/60 dark:text-white/60">
                    {system.size}
                  </div>
                )}
              </a>
            </div>
          ))}
      </>
    )
  }

  return (
    <div className="w-full lg:w-3/4 mx-auto px-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 py-10 gap-8">
        {groupTemnplate.map((item, i) => {
          return (
            <div
              className="border border-[#F0F0F0] dark:border-gray-800 rounded-xl text-center"
              key={i}
            >
              <div className="text-center">
                <div className="flex gap-2 p-4 border-b border-[#F0F0F0] dark:border-gray-800 items-center justify-center">
                  <div className="text-xl">
                    <item.logo />
                  </div>
                  <h6>{item.label}</h6>
                </div>
                <div className="mx-auto text-center py-2">
                  {renderDownloadLink(item.name)}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
