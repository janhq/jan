import React from 'react'
import { UserIcon, PaintBrushIcon, CogIcon } from '@heroicons/react/24/outline'

interface SettingsNavigationProps {
  activeSection: string
  onSectionChange: (section: string) => void
}

const navigationItems = [
  {
    name: 'Account',
    icon: UserIcon,
    id: 'account'
  },
  {
    name: 'Appearance',
    icon: PaintBrushIcon,
    id: 'appearance'
  },
  {
    name: 'Advanced',
    icon: CogIcon,
    id: 'advanced'
  }
]

const SettingsNavigation: React.FC<SettingsNavigationProps> = ({
  activeSection,
  onSectionChange
}) => {
  return (
    <nav className="space-y-1">
      {navigationItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onSectionChange(item.id)}
          className={`
            flex items-center px-3 py-2 text-sm font-medium rounded-md w-full
            ${
              activeSection === item.id
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }
          `}
        >
          <item.icon
            className={`
              mr-3 flex-shrink-0 h-6 w-6
              ${
                activeSection === item.id
                  ? 'text-gray-500'
                  : 'text-gray-400 group-hover:text-gray-500'
              }
            `}
          />
          {item.name}
        </button>
      ))}
    </nav>
  )
}

export default SettingsNavigation
