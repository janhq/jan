import { useCallback, useState, Fragment } from 'react'

import {
  InputAction,
  InputComponentProps,
  SettingComponentProps,
} from '@janhq/core'

import { Input } from '@janhq/joi'
import { CopyIcon, EyeIcon, FolderOpenIcon } from 'lucide-react'
import { marked } from '@/utils/marked'

type Props = {
  settingProps: SettingComponentProps
  onValueChanged?: (e: string) => void
}
const SettingDetailTextInputItem = ({
  settingProps,
  onValueChanged,
}: Props) => {
  const { value, type, placeholder, textAlign, inputActions } =
    settingProps.controllerProps as InputComponentProps
  const [obscure, setObscure] = useState(type === 'password')

  const description = marked.parse(settingProps.description ?? '', {
    async: false,
  })

  const toggleObscure = useCallback(() => {
    setObscure((prev) => !prev)
  }, [])

  const copy = useCallback(() => {
    navigator.clipboard.writeText(value)
  }, [value])

  const onAction = useCallback(
    (action: InputAction) => {
      switch (action) {
        case 'copy':
          copy()
          break
        case 'unobscure':
          toggleObscure()
          break
        default:
          break
      }
    },
    [toggleObscure, copy]
  )

  return (
    <div className="flex w-full flex-col justify-between gap-4 py-6 sm:flex-row">
      <div className="flex flex-1 flex-col space-y-1">
        <h1 className="font-semibold">{settingProps.title}</h1>
        <div
          dangerouslySetInnerHTML={{ __html: description }}
          className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
        />
      </div>
      <div className="w-full flex-shrink-0 pr-1 sm:w-1/2">
        <Input
          placeholder={placeholder}
          type={obscure ? 'password' : 'text'}
          textAlign={textAlign}
          value={value}
          onChange={(e) => onValueChanged?.(e.target.value)}
          suffixIcon={
            <InputExtraActions
              actions={inputActions ?? []}
              onAction={onAction}
            />
          }
        />
      </div>
    </div>
  )
}

type InputActionProps = {
  actions: InputAction[]
  onAction: (action: InputAction) => void
}

const InputExtraActions: React.FC<InputActionProps> = ({
  actions,
  onAction,
}) => {
  if (actions.length === 0) return <Fragment />

  return (
    <div className="flex flex-row space-x-2">
      {actions.map((action) => {
        switch (action) {
          case 'copy':
            return (
              <CopyIcon
                key={action}
                size={16}
                onClick={() => onAction(action)}
              />
            )

          case 'unobscure':
            return (
              <EyeIcon
                key={action}
                size={16}
                onClick={() => onAction(action)}
              />
            )

          default:
            return <FolderOpenIcon key={action} />
        }
      })}
    </div>
  )
}

export default SettingDetailTextInputItem
