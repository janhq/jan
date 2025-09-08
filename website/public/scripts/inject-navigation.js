// Navigation injection script for Jan documentation
// This script adds navigation links to regular docs pages (not API reference pages)

;(function () {
  // Navigation configuration for Jan docs
  const JAN_NAV_CONFIG = {
    // Product navigation links - easy to extend for multiple products
    links: [
      {
        href: '/',
        text: 'Docs',
        isActive: (path) =>
          path === '/' || (path.startsWith('/') && !path.startsWith('/api')),
      },
      {
        href: '/api',
        text: 'API Reference',
        isActive: (path) => path.startsWith('/api'),
      },
    ],

    // Pages that have their own navigation (don't inject nav)
    excludePaths: ['/api-reference/', '/api/'],
  }

  // Add navigation to docs pages with retry logic
  function addNavigation(retries = 0) {
    const currentPath = window.location.pathname

    // Skip if page has its own navigation
    const shouldSkipNav = JAN_NAV_CONFIG.excludePaths.some((path) =>
      currentPath.startsWith(path)
    )
    if (shouldSkipNav) return

    const header = document.querySelector('.header')
    const siteTitle = document.querySelector('.site-title')
    const existingNav = document.querySelector('.custom-nav-links')

    if (header && siteTitle && !existingNav) {
      // Find the right container for nav links
      const searchElement = header.querySelector('[class*="search"]')
      const flexContainer = header.querySelector('.sl-flex')
      const targetContainer = flexContainer || header

      if (targetContainer) {
        // Create navigation container
        const nav = document.createElement('nav')
        nav.className = 'custom-nav-links'
        nav.setAttribute('aria-label', 'Product Navigation')

        // Create links from configuration
        JAN_NAV_CONFIG.links.forEach((link) => {
          const a = document.createElement('a')
          a.href = link.href
          a.textContent = link.text
          a.className = 'nav-link'

          // Set active state
          if (link.isActive(currentPath)) {
            a.setAttribute('aria-current', 'page')
          }

          nav.appendChild(a)
        })

        // Insert navigation safely
        if (searchElement && targetContainer.contains(searchElement)) {
          targetContainer.insertBefore(nav, searchElement)
        } else {
          // Find site title and insert after it
          if (siteTitle && targetContainer.contains(siteTitle)) {
            siteTitle.insertAdjacentElement('afterend', nav)
          } else {
            targetContainer.appendChild(nav)
          }
        }
      } else if (retries < 5) {
        setTimeout(() => addNavigation(retries + 1), 500)
      }
    } else if (retries < 5) {
      setTimeout(() => addNavigation(retries + 1), 500)
    }
  }

  // Initialize navigation injection
  function initNavigation() {
    // Update logo link to jan.ai
    const logoLink = document.querySelector('a[href="/"]')
    if (logoLink && logoLink.getAttribute('href') === '/') {
      logoLink.href = 'https://jan.ai'
    }

    // Start navigation injection
    if (document.readyState === 'loading') {
      setTimeout(() => addNavigation(), 1000)
    } else {
      addNavigation()
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavigation)
  } else {
    initNavigation()
  }

  // Handle page navigation in SPA-like environments
  let lastUrl = location.href
  new MutationObserver(() => {
    const url = location.href
    if (url !== lastUrl) {
      lastUrl = url
      // Re-run navigation injection after navigation
      setTimeout(() => addNavigation(), 100)
    }
  }).observe(document, { subtree: true, childList: true })
})()
