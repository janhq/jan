import { InputComponentProps, SettingComponentProps } from '@janhq/core'
import { Input } from '@janhq/joi'
import { Marked, Renderer } from 'marked'

type Props = {
  settingProps: SettingComponentProps
  onValueChanged?: (e: string) => void
}

const marked: Marked = new Marked({
  renderer: {
    link: (href, title, text) => {
      return Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace(
          '<a',
          "<a class='text-[hsla(var(--app-link))]' target='_blank'"
        )
    },
  },
})

const SettingDetailTextInputItem = ({
  settingProps,
  onValueChanged,
}: Props) => {
  const { value, type, placeholder, textAlign } =
    settingProps.controllerProps as InputComponentProps

  const description = marked.parse(settingProps.description ?? '', {
    async: false,
  })

  return (
    <div className="flex w-full flex-col justify-between gap-4 py-6 sm:flex-row">
      <div className="flex flex-1 flex-col space-y-1">
        <h1 className="font-semibold">{settingProps.title}</h1>
        {
          <div
            // eslint-disable-next-line @typescript-eslint/naming-convention
            dangerouslySetInnerHTML={{ __html: description }}
            className="font-medium leading-relaxed text-[hsla(var(--app-text-secondary))]"
          />
        }
      </div>
      <div className="w-full flex-shrink-0 pr-1 sm:w-1/2">
        <Input
          placeholder={placeholder}
          type={type}
          textAlign={textAlign}
          value={value}
          onChange={(e) => onValueChanged?.(e.target.value)}
        />
      </div>
    </div>
  )
}

export default SettingDetailTextInputItem
