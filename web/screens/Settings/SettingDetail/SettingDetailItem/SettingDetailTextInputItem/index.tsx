import { InputComponentProps, SettingComponentProps } from '@janhq/core'
import { Input } from '@janhq/uikit'

type Props = {
  settingProps: SettingComponentProps
  onValueChanged?: (e: string) => void
}

const SettingDetailTextInputItem: React.FC<Props> = ({
  settingProps,
  onValueChanged,
}) => {
  const { value, type, placeholder } =
    settingProps.controllerProps as InputComponentProps

  return (
    <div className="flex w-full justify-between py-6">
      <div className="flex flex-1 flex-col space-y-1">
        <h1 className="text-base font-bold">{settingProps.title}</h1>
        <span className="text-sm font-normal text-muted-foreground">
          {settingProps.description}
        </span>
      </div>
      <Input
        placeholder={placeholder}
        type={type}
        value={value}
        className="w-[360px]"
        onChange={(e) => onValueChanged?.(e.target.value)}
      />
    </div>
  )
}

export default SettingDetailTextInputItem
