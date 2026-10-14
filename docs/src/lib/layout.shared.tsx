import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    // The Jan navbar (components/navbar.tsx) sits above the layout, so the
    // Fumadocs header only shows its mobile sidebar trigger.
    nav: {
      title: (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-jan.svg" alt="" className="h-5 w-5" />
          <span className="font-bold">Jan Docs</span>
        </>
      ),
      url: '/',
    },
    themeSwitch: { enabled: false },
  }
}
