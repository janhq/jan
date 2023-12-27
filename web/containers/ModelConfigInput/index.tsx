import { Textarea } from '@janhq/uikit'

import { useAtomValue } from 'jotai'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getActiveThreadIdAtom } from '@/helpers/atoms/Thread.atom'

type Props = {
  title: string
  name: string
  placeholder: string
  value: string
}

const ModelConfigInput: React.FC<Props> = ({
  title,
  name,
  value,
  placeholder,
}) => {
  const { updateModelParameter } = useUpdateModelParameters()
  const threadId = useAtomValue(getActiveThreadIdAtom)

  const onValueChanged = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!threadId) return

    updateModelParameter(threadId, name, e.target.value)
  }

  return (
    <div className="flex flex-col">
      <p className="mb-2 text-sm font-semibold text-gray-600">{title}</p>
      <Textarea
        placeholder={placeholder}
        onChange={onValueChanged}
        value={value}
      />
    </div>
  )
}

export default ModelConfigInput
