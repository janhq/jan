# Rebranding Guide

This repository supports rebranding to a custom product name and identity through a centralized configuration file and an automated script.

## Quick Start

1. **Edit `branding.json`** in the repository root with your brand values:

```json
{
  "appName": "MyApp",
  "productName": "MyApp",
  "identifier": "com.mycompany.myapp",
  "identifierIos": "com.mycompany.myapp.ios",
  "author": "My Company <hello@mycompany.com>",
  "publisher": "My Company Inc.",
  "homepage": "https://mycompany.com",
  "repository": "https://github.com/mycompany/myapp",
  "description": "My custom AI assistant application.",
  "packageScope": "@mycompany",
  "rootPackageName": "myapp",
  "corePackageName": "@mycompany/core",
  "webAppPackageName": "@mycompany/web-app",
  "pageTitle": "MyApp",
  "logoFilename": "myapp-logo.png",
  "logoAlt": "MyApp Logo"
}
```

2. **Run the rebrand script:**

```bash
node scripts/rebrand.js
```

3. **Rebuild the application:**

```bash
yarn install && yarn build
```

## What the Script Updates

The `scripts/rebrand.js` script automatically updates these files:

| Area | Files Updated | Fields Changed |
|------|--------------|----------------|
| **Tauri config** | `src-tauri/tauri.conf.json` | `productName`, `identifier`, `bundle.publisher` |
| **Window titles** | `src-tauri/tauri.{linux,macos,windows}.conf.json` | `app.windows[0].title` |
| **Mobile configs** | `src-tauri/tauri.{ios,android}.conf.json` | `identifier` |
| **Root package** | `package.json` | `name` |
| **Core library** | `core/package.json` | `name`, `homepage`, `author`, `description` |
| **HTML entry** | `web-app/index.html` | `<title>`, logo file references, logo alt text |
| **Locales** | `web-app/src/locales/*/common.json` | `jan` key, `helpUsImproveJan` key |
| **Rust config** | `src-tauri/Cargo.toml` | `name`, `authors`, `description`, `repository` |

## Manual Steps After Running the Script

Some changes require manual intervention:

### 1. Replace Logo Files

Place your logo image at `web-app/public/images/<logoFilename>` (matching the `logoFilename` in `branding.json`). The default is `jan-logo.png`.

### 2. Replace App Icons

Replace the source icon and regenerate platform-specific icons:

```bash
# Replace with your icon (1024x1024 PNG recommended)
cp /path/to/your-icon.png src-tauri/icons/icon.png

# Regenerate all platform-specific icons
yarn build:icon
```

### 3. Update Extension Package Names (Optional)

If you want to rename extensions under your own package scope, update each `extensions/*/package.json` file's `name` and `author` fields.

### 4. Update CI/CD Endpoints (Optional)

If using custom update servers, update the `plugins.updater.endpoints` array in `src-tauri/tauri.conf.json`.

### 5. Update Documentation (Optional)

Review and update documentation files in `docs/` to reflect your brand.

## Custom Branding File Path

You can pass a custom path to the rebrand script:

```bash
node scripts/rebrand.js /path/to/custom-branding.json
```

This allows maintaining multiple brand configurations for different product variants.
