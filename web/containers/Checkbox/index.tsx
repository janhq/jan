import { useEffect, useState } from 'react'

type Props = {
  name: string
  title: string
  checked: boolean
  register: any
}

const Checkbox: React.FC<Props> = ({ name, title, checked, register }) => {
  const [currentChecked, setCurrentChecked] = useState<boolean>(checked)

  useEffect(() => {
    setCurrentChecked(checked)
  }, [checked])

  return (
    <div className="flex justify-between">
      <label>{title}</label>
      <input
        type="checkbox"
        checked={currentChecked}
        {...register(name)}
        onChange={(e) => setCurrentChecked(e.target.checked)}
      />
    </div>
  )
}

export default Checkbox
