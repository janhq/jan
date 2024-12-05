import React, { useState, useEffect } from 'react'
import { IconType } from 'react-icons/lib'
import { FaWindows, FaApple, FaLinux } from 'react-icons/fa'
import { twMerge } from 'tailwind-merge'
import { DownloadIcon } from 'lucide-react'

type Props = {
  lastRelease: any
}

type SystemType = {
  name: string
  label: string
  logo: IconType
  fileFormat: string
  href?: string
}

const systemsTemplate: SystemType[] = [
  {
    name: 'Mac ',
    label: 'Universal',
    logo: FaApple,
    fileFormat: '{appname}-mac-universal-{tag}.dmg',
  },

  {
    name: 'Windows',
    label: 'Standard (64-bit)',
    logo: FaWindows,
    fileFormat: '{appname}-win-x64-{tag}.exe',
  },
  {
    name: 'Linux (AppImage)',
    label: 'AppImage',
    logo: FaLinux,
    fileFormat: '{appname}-linux-x86_64-{tag}.AppImage',
  },
  {
    name: 'Linux (deb)',
    label: 'Deb',
    logo: FaLinux,
    fileFormat: '{appname}-linux-amd64-{tag}.deb',
  },
]

const groupTemnplate = [
  { label: 'MacOS', name: 'mac', logo: FaApple },
  { label: 'Windows', name: 'windows', logo: FaWindows },
  { label: 'Linux', name: 'linux', logo: FaLinux },
]

export default function CardDownload({ lastRelease }: Props) {
  const [systems, setSystems] = useState(systemsTemplate)

  const extractAppName = (fileName: string) => {
    const regex = /^(.*?)-(?:mac|win|linux)-(?:arm64|x64|amd64|x86_64)-.*$/
    const match = fileName.match(regex)
    return match ? match[1] : null
  }

  useEffect(() => {
    const updateDownloadLinks = async () => {
      try {
        // Extract appname from the first asset name
        const firstAssetName = lastRelease.assets[0].name
        const appname = extractAppName(firstAssetName)

        if (!appname) {
          console.error(
            'Failed to extract appname from file name:',
            firstAssetName
          )

          return
        }

        // Remove 'v' at the start of the tag_name
        const tag = lastRelease.tag_name.startsWith('v')
          ? lastRelease.tag_name.substring(1)
          : lastRelease.tag_name

        const updatedSystems = systems.map((system) => {
          const downloadUrl = system.fileFormat
            .replace('{appname}', appname)
            .replace('{tag}', tag)
          return {
            ...system,
            href: `https://github.com/janhq/jan/releases/download/${lastRelease.tag_name}/${downloadUrl}`,
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
