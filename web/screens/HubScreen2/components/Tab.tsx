import { twMerge } from 'tailwind-merge'

type Props = {
  tab: ModelTab
  handleTab: (ModelTab: string) => void
}

export const AvailableLocalModelTabs = ['Versions', 'Information'] as const
export type ModelTab = (typeof AvailableLocalModelTabs)[number]

const Tab: React.FC<Props> = ({ tab, handleTab }) => {
  return (
    <div className="mt-2 w-full border-b border-[hsla(var(--app-border))]">
      {AvailableLocalModelTabs.map((item) => (
        <button
          className={twMerge(
            'relative px-4 py-2 text-base leading-6',
            tab === item
              ? 'font-semibold text-[hsla(var(--text-primary))]'
              : 'text-[hsla(var(--text-secondary))]'
          )}
          onClick={() => handleTab(item)}
          key={item}
        >
          {item}
          <div
            className={twMerge(
              tab === item &&
                'absolute bottom-[-1px] right-0 z-10 h-[1px] w-full bg-[hsla(var(--primary-bg))]'
            )}
          />
        </button>
      ))}
    </div>
  )
}

export default Tab
