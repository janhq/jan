# Navigation Configuration

This directory contains configuration files for managing navigation across Jan's documentation sites.

## Overview

As Jan grows to include multiple products (Jan Desktop, Jan Server, Jan Mobile, etc.), we need a scalable way to manage navigation across different documentation sections. This configuration approach allows us to:

1. **Maintain consistency** across different products
2. **Avoid duplication** in navigation code
3. **Scale easily** as new products are added
4. **Separate concerns** between regular docs and API reference pages

## Structure

### `navigation.js`
Central navigation configuration file containing:
- Product-specific navigation links
- API deployment configurations
- Helper functions for navigation management
- Feature flags for navigation behavior

## Navigation Strategy

### Regular Documentation Pages
- Navigation is injected via `astro.config.mjs`
- Shows "Docs" and "API Reference" links
- Appears in the main header next to search

### API Reference Pages
- Have their own navigation via `ApiReferenceLayout.astro`
- Navigation is built into the layout (not injected)
- Prevents duplicate navigation elements

## Adding New Products

To add navigation for a new product:

1. Update `navigation.js`:
```javascript
products: {
  janServer: {
    name: 'Jan Server',
    links: [
      { href: '/server', text: 'Server Docs', isActive: (path) => path.startsWith('/server') },
      { href: '/server/api', text: 'Server API', isActive: (path) => path.startsWith('/server/api') }
    ]
  }
}
```

2. Update `astro.config.mjs` if needed to handle product-specific logic

3. Create corresponding layout components if the product needs custom API reference pages

## Configuration in astro.config.mjs

The navigation injection in `astro.config.mjs` is kept minimal and clean:

```javascript
const JAN_NAV_CONFIG = {
  links: [/* navigation links */],
  excludePaths: [/* paths that have their own navigation */]
};
```

This configuration:
- Is easy to read and modify
- Doesn't interfere with API reference pages
- Can be extended for multiple products
- Maintains clean separation of concerns

## Best Practices

1. **Keep it simple**: Navigation configuration should be declarative, not complex logic
2. **Avoid duplication**: Use the configuration to generate navigation, don't hardcode it multiple places
3. **Test changes**: Always verify navigation works on both regular docs and API reference pages
4. **Document changes**: Update this README when adding new products or changing navigation strategy

## Testing Navigation

After making changes, verify:
1. Navigation appears correctly on regular docs pages
2. Navigation doesn't duplicate on API reference pages
3. Active states work correctly
4. Mobile responsiveness is maintained
5. Theme switching doesn't break navigation

## Future Considerations

- **Product switcher**: Add a dropdown to switch between different product docs
- **Version selector**: Add version switching for API documentation
- **Search integration**: Integrate product-specific search scopes
- **Analytics**: Track navigation usage to improve UX

## Related Files

- `/astro.config.mjs` - Navigation injection for regular docs
- `/src/components/ApiReferenceLayout.astro` - API reference navigation
- `/src/pages/api.astro` - API documentation landing page
- `/src/pages/api-reference/*.astro` - API reference pages