/**
 * Navigation Configuration
 *
 * Centralized navigation configuration for Jan documentation.
 * This makes it easy to manage navigation across multiple products
 * and maintain consistency across different documentation sections.
 */

export const NAVIGATION_CONFIG = {
  // Main product navigation links
  products: {
    jan: {
      name: 'Jan',
      links: [
        {
          href: '/',
          text: 'Docs',
          isActive: (path) => path === '/' || (path.startsWith('/') && !path.startsWith('/api')),
          description: 'Jan documentation and guides'
        },
        {
          href: '/api',
          text: 'API Reference',
          isActive: (path) => path.startsWith('/api'),
          description: 'OpenAI-compatible API documentation'
        }
      ]
    },
    // Future products can be added here
    // Example:
    // janServer: {
    //   name: 'Jan Server',
    //   links: [
    //     { href: '/server', text: 'Server Docs', isActive: (path) => path.startsWith('/server') },
    //     { href: '/server/api', text: 'Server API', isActive: (path) => path.startsWith('/server/api') }
    //   ]
    // }
  },

  // API deployment configurations
  apiDeployments: {
    local: {
      name: 'Local API',
      defaultServers: [
        { url: 'http://127.0.0.1:1337', description: 'Local Jan Server (Default)' },
        { url: 'http://localhost:1337', description: 'Local Jan Server (localhost)' },
        { url: 'http://localhost:8080', description: 'Local Jan Server (Alternative Port)' }
      ],
      requiresAuth: false,
      engine: 'llama.cpp'
    },
    cloud: {
      name: 'Jan Server',
      defaultServers: [
        { url: 'https://api.jan.ai/v1', description: 'Jan Server (Production)' },
        { url: 'http://localhost:8000/v1', description: 'Jan Server (Local Development)' }
      ],
      requiresAuth: true,
      engine: 'vLLM'
    }
  },

  // Navigation styles configuration
  styles: {
    navLink: {
      base: 'nav-link',
      active: 'nav-link-active'
    },
    container: {
      base: 'custom-nav-links',
      mobile: 'custom-nav-links-mobile'
    }
  },

  // Feature flags for navigation behavior
  features: {
    persistCustomServer: true,
    allowUrlParams: true,
    showProductSwitcher: false, // For future multi-product support
    mobileMenuBreakpoint: 768
  },

  // Helper functions
  helpers: {
    /**
     * Get navigation links for current product
     * @param {string} productKey - The product identifier
     * @returns {Array} Navigation links for the product
     */
    getProductNav(productKey = 'jan') {
      return this.products[productKey]?.links || [];
    },

    /**
     * Determine if current path should show API reference navigation
     * @param {string} path - Current pathname
     * @returns {boolean} Whether to show API reference navigation
     */
    isApiReferencePage(path) {
      return path.startsWith('/api-reference/') || path.startsWith('/api/');
    },

    /**
     * Get server configuration for deployment type
     * @param {string} deployment - 'local' or 'cloud'
     * @returns {Object} Server configuration
     */
    getServerConfig(deployment) {
      return this.apiDeployments[deployment] || this.apiDeployments.local;
    },

    /**
     * Build navigation HTML for injection
     * @param {string} currentPath - Current page path
     * @param {string} productKey - Product identifier
     * @returns {string} HTML string for navigation
     */
    buildNavigationHTML(currentPath, productKey = 'jan') {
      const links = this.getProductNav(productKey);

      return links.map(link => `
        <a href="${link.href}"
           class="${this.styles.navLink.base} ${link.isActive(currentPath) ? this.styles.navLink.active : ''}"
           ${link.isActive(currentPath) ? 'aria-current="page"' : ''}
           title="${link.description || link.text}">
          ${link.text}
        </a>
      `).join('');
    }
  }
};

// Export for use in browser context
if (typeof window !== 'undefined') {
  window.JanNavigationConfig = NAVIGATION_CONFIG;
}

export default NAVIGATION_CONFIG;
