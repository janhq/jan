import { useEffect, useState } from 'react'

import { Button, Select } from '@janhq/joi'
import { Copy } from 'lucide-react'

import InputApiKey from './InputApiKey'

type Props = {
  variants: string[]
}

const UseWithCortex: React.FC<Props> = ({ variants }) => {
  const [variant, setVariant] = useState(variants[0])

  useEffect(() => {
    setVariant(variants[0])
  }, [variants])

  const options: { name: string; value: string }[] = variants.map((v) => {
    return { name: v, value: v }
  })

  return (
    <div className="mt-4 flex items-center gap-2">
      <Select
        value={variant}
        className="gap-1.5 whitespace-nowrap px-4 py-2 font-semibold"
        options={options}
        onValueChange={(value) => setVariant(value)}
      />
      <InputApiKey className="max-w-[355px] p-2 leading-[16.94px]" />
      <Button>
        <Copy size={18} />
      </Button>
    </div>
  )
}

export default UseWithCortex
