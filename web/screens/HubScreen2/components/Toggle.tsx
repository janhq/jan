import { twMerge } from 'tailwind-merge'

const Toggle: React.FC = () => {
  return (
    <label className="inline-flex cursor-pointer items-center rounded-full border">
      <input type="checkbox" value="" className="peer sr-only" />
      <div
        className={twMerge(
          'peer relative h-4 w-[28.8px] rounded-full bg-white',
          "after:absolute after:start-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-['']",
          'peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rtl:peer-checked:after:-translate-x-full dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800'
        )}
      />
    </label>
  )
}
export default Toggle
