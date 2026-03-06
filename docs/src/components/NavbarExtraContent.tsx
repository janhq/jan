import { FaDiscord, FaGithub } from 'react-icons/fa'
import { FaXTwitter, FaLinkedinIn } from 'react-icons/fa6'
import { FiDownload } from 'react-icons/fi'
import { Button } from './ui/button'

export default function NavbarExtraContent() {
  return (
    <div className="flex items-center gap-4">
      <div className="hidden lg:flex items-center gap-3 text-black">
        <a href="https://discord.com/invite/FTk2MvZwJH" target="_blank" rel="noopener noreferrer" aria-label="Discord">
          <FaDiscord className="size-5" />
        </a>
        <a href="https://twitter.com/jandotai" target="_blank" rel="noopener noreferrer" aria-label="Twitter">
          <FaXTwitter className="size-5" />
        </a>
        <a href="https://linkedin.com/company/opensuperintelligence" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
          <FaLinkedinIn className="size-5" />
        </a>
        <a href="https://github.com/janhq/jan" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
          <FaGithub className="size-5" />
        </a>
      </div>
      <a href="https://github.com/janhq/jan/releases/latest" target="_blank" rel="noopener noreferrer">
        <Button size="sm" className="bg-black text-white hover:bg-gray-800 hidden lg:flex items-center gap-1">
          <FiDownload className="size-4" />
          Download
        </Button>
      </a>
    </div>
  )
}
