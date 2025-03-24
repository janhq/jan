import { useCallback, useState, Fragment } from 'react'

import {
  InputAction,
  InputComponentProps,
  SettingComponentProps,
} from '@janhq/core'

import { Input } from '@janhq/joi'
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FolderOpenIcon,
} from 'lucide-react'
import { Marked, Renderer } from 'marked'
import { twMerge } from 'tailwind-merge'

type Props = {
  settingProps: SettingComponentProps
  onValueChanged?: (e: string) => void
}

const marked: Marked = new Marked({
  renderer: {
    link: (href, title, text) =>
      Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace(
          '<a',
          "<a class='text-[hsla(var(--app-link))]' target='_blank'"
        ),
  },
})

const SettingDetailTextInputItem = ({
  settingProps,
  onValueChanged,
}: Props) => {
  const { value, type, placeholder, textAlign, inputActions } =
    settingProps.controllerProps as InputComponentProps
  const [obscure, setObscure] = useState(type === 'password')
  const [copied, setCopied] = useState(false)

  const description = marked.parse(settingProps.description ?? '', {
    async: false,
  })

  const toggleObscure = useCallback(() => {
    setObscure((prev) => !prev)
  }, [])

  const copy = useCallback(() => {
    navigator.clipboard.writeText(value as string)
    if (value.length > 0) {
      setCopied(true)
    }
    setTimeout(() => setCopied(false), 2000) // Reset icon after 2 seconds
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
      <div
        className={twMerge(
          'w-full flex-shrink-0 pr-1 sm:w-1/2',
          type === 'number' && 'sm:w-22 w-50'
        )}
      >
        <Input
          placeholder={placeholder}
          type={obscure ? 'password' : 'text'}
          textAlign={textAlign}
          value={value}
          onChange={(e) => onValueChanged?.(e.target.value)}
          className={twMerge(obscure && '!pr-20')}
          suffixIcon={
            obscure ? (
              <InputExtraActions
                actions={inputActions ?? []}
                onAction={onAction}
                value={value}
                copied={copied}
                obscure={obscure}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  )
}

type InputActionProps = {
  actions: InputAction[]
  onAction: (action: InputAction) => void
  copied: boolean
  obscure: boolean
  value: string | string[]
}

const InputExtraActions: React.FC<InputActionProps> = ({
  actions,
  onAction,
  value,
  copied,
  obscure,
}) => {
  if (actions.length === 0) return <Fragment />

  return (
    <div className="flex flex-row space-x-2">
      {actions.map((action) => {
        switch (action) {
          case 'copy':
            return copied ? (
              <CheckIcon
                key={action}
                size={16}
                onClick={() => onAction('copy')}
                className="text-green-600"
              />
            ) : (
              <>
                {value.length > 0 && (
                  <CopyIcon
                    key={action}
                    size={16}
                    onClick={() => onAction('copy')}
                  />
                )}
              </>
            )

          case 'unobscure':
            return obscure ? (
              <EyeIcon
                key={action}
                size={16}
                onClick={() => onAction('unobscure')}
              />
            ) : (
              <EyeOffIcon
                key={action}
                size={16}
                onClick={() => onAction('unobscure')}
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
