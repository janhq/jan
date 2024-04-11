import { CheckboxComponentProps, SettingComponentProps } from '@janhq/core'
import { Switch } from '@janhq/uikit'
import { Marked, Renderer } from 'marked'

type Props = {
  settingProps: SettingComponentProps
  onValueChanged?: (e: boolean) => void
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

const SettingDetailToggleItem: React.FC<Props> = ({
  settingProps,
  onValueChanged,
}) => {
  const { value } = settingProps.controllerProps as CheckboxComponentProps

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
      <Switch checked={value} onCheckedChange={onValueChanged} />
    </div>
  )
}

export default SettingDetailToggleItem
