type Props = {
  className?: string
  placeholder?: string
}

const InputApiKey: React.FC<Props> = ({ className, placeholder }) => (
  <input
    className={`text-[hsla(var(--text-secondary)] w-full rounded-md border p-2 leading-[16.94px] ${className}`}
    placeholder={placeholder}
    type="text"
  />
)
export default InputApiKey
