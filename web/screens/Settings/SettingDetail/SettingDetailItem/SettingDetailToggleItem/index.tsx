import { ChangeEvent } from 'react'

import { CheckboxComponentProps, SettingComponentProps } from '@janhq/core'
import { Switch } from '@janhq/joi'
import { Marked, Renderer } from 'marked'

type Props = {
  settingProps: SettingComponentProps
  onValueChanged?: (e: ChangeEvent<HTMLInputElement>) => void
}

const marked: Marked = new Marked({
  renderer: {
    link: (href, title, text) => {
      return Renderer.prototype.link
        ?.apply(this, [href, title, text])
        .replace(
          '<a',
          "<a class='text-[hsla(var(--text-link))]' target='_blank'"
        )
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
        <h1 className="font-semibold">{settingProps.title}</h1>
        {
          <div
            // eslint-disable-next-line @typescript-eslint/naming-convention
            dangerouslySetInnerHTML={{ __html: description }}
            className="font-medium leading-relaxed text-[hsla(var(--text-secondary))]"
          />
        }
      </div>
      <Switch checked={value} onChange={onValueChanged} />
    </div>
  )
}

export default SettingDetailToggleItem
