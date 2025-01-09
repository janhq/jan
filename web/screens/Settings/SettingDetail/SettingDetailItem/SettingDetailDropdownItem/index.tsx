import { DropdownComponentProps, SettingComponentProps } from '@janhq/core'
import { Select } from '@janhq/joi'
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

const SettingDetailDropdownItem: React.FC<Props> = ({
  settingProps,
  onValueChanged,
}) => {
  const { value, options } =
    settingProps.controllerProps as DropdownComponentProps

  const description = marked.parse(settingProps.description ?? '', {
    async: false,
  })

  return (
    <div className="flex w-full justify-between py-6">
      <div className="flex flex-1 flex-col space-y-1">
        <h1 className="font-semibold">{settingProps.title}</h1>
        {
          <div
            dangerouslySetInnerHTML={{ __html: description }}
            className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
          />
        }
      </div>
      <Select value={value} onValueChange={onValueChanged} options={options} />
    </div>
  )
}

export default SettingDetailDropdownItem
