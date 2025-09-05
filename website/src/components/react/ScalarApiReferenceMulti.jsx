import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'
import { useEffect, useState } from 'react'

const ScalarApiReferenceMulti = ({
  specUrl,
  title,
  description,
  deployment = 'local',
}) => {
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [serverUrl, setServerUrl] = useState('')

  useEffect(() => {
    // Theme detection for Starlight
    const getCurrentTheme = () => {
      const htmlElement = document.documentElement
      const theme = htmlElement.getAttribute('data-theme')
      const isDark =
        theme === 'dark' ||
        (theme !== 'light' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches)

      setIsDarkMode(isDark)
    }

    // Set initial theme
    getCurrentTheme()

    // Watch for theme changes
    const observer = new MutationObserver(() => {
      getCurrentTheme()
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })

    // Watch for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      getCurrentTheme()
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange)

    // Check for custom server URL in localStorage or URL params
    const params = new URLSearchParams(window.location.search)
    const customServer =
      params.get('server') || localStorage.getItem('jan-api-server')
    if (customServer) {
      setServerUrl(customServer)
    }

    return () => {
      observer.disconnect()
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }
  }, [])

  // Get deployment-specific servers
  const getServers = () => {
    const customServers = serverUrl
      ? [{ url: serverUrl, description: 'Custom Server' }]
      : []

    if (deployment === 'cloud') {
      return [
        ...customServers,
        {
          url: 'https://api.jan.ai/v1',
          description: 'Jan Server (Production)',
        },
        {
          url: 'http://localhost:8000/v1',
          description: 'Jan Server (Local Development)',
        },
      ]
    }

    // Local deployment
    return [
      ...customServers,
      {
        url: 'http://127.0.0.1:1337',
        description: 'Local Jan Server (Default)',
      },
      {
        url: 'http://localhost:1337',
        description: 'Local Jan Server (localhost)',
      },
      {
        url: 'http://localhost:8080',
        description: 'Local Jan Server (Alternative Port)',
      },
    ]
  }

  return (
    <div className="scalar-wrapper">
      {/* Optional server URL input */}
      <div
        className="server-config"
        style={{
          padding: '1rem',
          background: 'var(--sl-color-bg-nav)',
          borderBottom: '1px solid var(--sl-color-hairline)',
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          fontSize: '0.9rem',
        }}
      >
        <label
          htmlFor="custom-server"
          style={{ color: 'var(--sl-color-gray-3)' }}
        >
          Custom Server URL (optional):
        </label>
        <input
          id="custom-server"
          type="text"
          placeholder="e.g., http://localhost:3000"
          value={serverUrl}
          onChange={(e) => {
            setServerUrl(e.target.value)
            localStorage.setItem('jan-api-server', e.target.value)
          }}
          style={{
            padding: '0.25rem 0.5rem',
            background: 'var(--sl-color-bg)',
            border: '1px solid var(--sl-color-hairline)',
            borderRadius: '4px',
            color: 'var(--sl-color-text)',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            flex: '1',
            maxWidth: '300px',
          }}
        />
        <button
          onClick={() => {
            setServerUrl('')
            localStorage.removeItem('jan-api-server')
          }}
          style={{
            padding: '0.25rem 0.75rem',
            background: 'var(--sl-color-gray-6)',
            color: 'var(--sl-color-text)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Reset
        </button>
      </div>

      <ApiReferenceReact
        configuration={{
          spec: {
            url: specUrl,
          },
          theme: 'default',
          darkMode: isDarkMode,
          layout: 'modern',
          hideModels: false,
          hideDownloadButton: false,
          hideTestRequestButton: false,
          showSidebar: true,
          authentication:
            deployment === 'cloud'
              ? {
                  preferredSecurityScheme: 'bearerAuth',
                  apiKey: {
                    token: '',
                  },
                }
              : undefined,
          servers: getServers(),
          metaData: {
            title: title || 'Jan API Reference',
            description:
              description || "Jan's OpenAI-compatible API documentation",
          },
          customCss: `
            /* Minimal theme sync with Starlight */
            :root {
              --scalar-color-accent: ${isDarkMode ? '#22c55e' : '#16a34a'};
            }

            /* Fix logo visibility in light mode */
            .scalar-api-reference .dark-mode-logo {
              display: ${isDarkMode ? 'block' : 'none'};
            }

            .scalar-api-reference .light-mode-logo {
              display: ${isDarkMode ? 'none' : 'block'};
            }

            /* Ensure logo contrast in header */
            .scalar-api-reference header img[alt*="Jan"] {
              filter: ${isDarkMode ? 'none' : 'invert(1)'};
            }
          `,
        }}
      />
    </div>
  )
}

export default ScalarApiReferenceMulti
