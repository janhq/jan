import { useEffect, useState } from 'react'

type Props = {
  name: string
  title: string
  min: number
  max: number
  step: number
  value: number
  register: any
}

const Slider: React.FC<Props> = ({
  name,
  title,
  min,
  max,
  step,
  value,
  register,
}) => {
  const [currentValue, setCurrentValue] = useState<number>(value)

  useEffect(() => {
    setCurrentValue(value)
  }, [value])

  return (
    <div className="flex flex-col">
      <p>{title}</p>
      <input
        {...register(name)}
        value={currentValue}
        onChange={(e) => setCurrentValue(Number(e.target.value))}
        type="range"
        min={min}
        max={max}
        step={step}
      />
    </div>
  )
}

export default Slider
