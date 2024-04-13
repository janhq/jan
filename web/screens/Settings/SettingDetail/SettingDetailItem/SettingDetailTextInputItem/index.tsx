import { InputComponentProps, SettingComponentProps } from '@janhq/core'
import { Input } from '@janhq/uikit'
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
        .replace('<a', "<a class='text-blue-500' target='_blank'")
    },
  },
})

const SettingDetailTextInputItem: React.FC<Props> = ({
  settingProps,
  onValueChanged,
}) => {
  const { value, type, placeholder, textAlign } =
    settingProps.controllerProps as InputComponentProps

  const description = marked.parse(settingProps.description ?? '', {
    async: false,
  })

  return (
    <div className="flex w-full justify-between py-6">
      <div className="flex flex-1 flex-col space-y-1">
        <h1 className="text-base font-bold">{settingProps.title}</h1>
        {
          <div
            // eslint-disable-next-line @typescript-eslint/naming-convention
            dangerouslySetInnerHTML={{ __html: description }}
            className="text-sm font-normal text-muted-foreground"
          />
        }
      </div>
      <Input
        placeholder={placeholder}
        type={type}
        textAlign={textAlign}
        value={value}
        className="ml-4 w-[360px]"
        onChange={(e) => onValueChanged?.(e.target.value)}
      />
    </div>
  )
}

export default SettingDetailTextInputItem
