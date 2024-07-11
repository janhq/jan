import { Fragment, useRef, useState } from 'react'

import Image from 'next/image'

import { Button, Select } from '@janhq/joi'
import { ChevronsLeftRight, Copy, ExternalLink } from 'lucide-react'

import DropdownModal from './DropdownModal'

type Props = {
  name: string
  onActionClick: () => void
}

const HeaderModal: React.FC<Props> = ({ name, onActionClick }) => {
  const [searchFilter, setSearchFilter] = useState('all')
  const textRef = useRef<HTMLDivElement>(null)

  const handleCoppy = () => {
    navigator.clipboard.writeText(textRef.current?.innerText ?? '')
  }
  const title = name.charAt(0).toUpperCase() + name.slice(1)

  return (
    <div className="flex items-center">
      <span className="text-xl font-semibold leading-8">{title}</span>
      <DropdownModal
        className="z-[500] min-w-[320px] rounded-lg border bg-white p-3 shadow-dropDown"
        trigger={
          <div className="ml-auto mr-3 flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-4 py-2">
            <Image
              width={22.5}
              height={18}
              src="/icons/ic_cortex.svg"
              alt="Cortex icon"
            />
            <span className="text-[16.2px] font-bold leading-[9px]">Cotex</span>
            <ChevronsLeftRight size={16} color="#00000099" />
          </div>
        }
        content={
          <Fragment>
            <Select
              value={searchFilter}
              className="z-[999] h-8 w-full gap-1 px-2"
              options={[
                { name: 'All', value: 'all' },
                { name: 'On-device', value: 'local' },
                { name: 'Cloud', value: 'remote' },
              ]}
              onValueChange={(value) => setSearchFilter(value)}
            />
            <div className="mt-3 flex w-full items-center gap-1 font-medium text-[var(--text-primary)]">
              <div
                ref={textRef}
                className="line-clamp-1 flex-1 whitespace-nowrap rounded-md border bg-[#0000000F] p-2 leading-[16.71px]"
              >
                cortex run llama3:70b-text-q2_K
              </div>
              <button
                onClick={handleCoppy}
                className="flex h-8 w-8 items-center justify-center rounded-md border bg-white"
              >
                <Copy size={18} />
              </button>
            </div>
            <a className="mt-4 flex items-center gap-1 text-xs text-[#2563EB] no-underline">
              Cortex Quickstart Guide
              <ExternalLink size={12} />
            </a>
          </Fragment>
        }
      />
      <Button
        className="mr-6 px-4 py-2"
        onClick={onActionClick}
        variant="solid"
      >
        <span className="text-sm font-semibold">Set Up</span>
      </Button>
    </div>
  )
}
export default HeaderModal
