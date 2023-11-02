import React from 'react'

import SecondaryButton from '../SecondaryButton'

const SidebarFooter: React.FC = () => (
  <div className="mx-3 flex items-center justify-between gap-2">
    <SecondaryButton
      title={'Discord'}
      onClick={() =>
        window.coreAPI?.openExternalUrl('https://discord.gg/AsJ8krTT3N')
      }
      className="flex-1"
    />
    <SecondaryButton
      title={'Twitter'}
      onClick={() =>
        window.coreAPI?.openExternalUrl('https://twitter.com/janhq_')
      }
      className="flex-1"
    />
  </div>
)

export default React.memo(SidebarFooter)
