import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')

/**
 * Replaces a JSON field value in-place using regex, preserving file formatting.
 * Handles string values only.
 */
function replaceJsonField(content, key, newValue) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`("${escaped}"\\s*:\\s*)"[^"]*"`)
  return content.replace(re, `$1"${newValue}"`)
}

/**
 * Reads a file, applies field replacements, and writes back only if changed.
 */
function updateJsonFields(filePath, replacements) {
  let content = readFileSync(filePath, 'utf-8')
  let updated = content
  for (const [key, value] of Object.entries(replacements)) {
    updated = replaceJsonField(updated, key, value)
  }
  if (updated !== content) {
    writeFileSync(filePath, updated, 'utf-8')
    console.log(`  Updated: ${filePath}`)
  }
}

/**
 * Applies branding from branding.json across the repository.
 * Uses targeted string replacement to preserve original file formatting.
 */
export function applyBranding(brandingPath) {
  const branding = JSON.parse(readFileSync(brandingPath || join(ROOT, 'branding.json'), 'utf-8'))
  const root = brandingPath ? dirname(brandingPath) : ROOT

  console.log(`Applying branding: "${branding.appName}"`)

  // 1. Tauri main config
  console.log('\n[1/7] Updating Tauri configuration...')
  const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json')
  try {
    updateJsonFields(tauriConfPath, {
      productName: branding.productName,
      identifier: branding.identifier,
      publisher: branding.publisher
    })
  } catch {
    // tauri.conf.json may not exist
  }

  // 2. Tauri platform-specific configs (window titles)
  console.log('\n[2/7] Updating platform window titles...')
  for (const platform of ['linux', 'macos', 'windows']) {
    const confPath = join(root, 'src-tauri', `tauri.${platform}.conf.json`)
    try {
      updateJsonFields(confPath, { title: branding.productName })
    } catch {
      // Platform config may not exist
    }
  }

  // Tauri iOS config
  try {
    updateJsonFields(join(root, 'src-tauri', 'tauri.ios.conf.json'), {
      identifier: branding.identifierIos
    })
  } catch {
    // iOS config may not exist
  }

  // Tauri Android config
  try {
    updateJsonFields(join(root, 'src-tauri', 'tauri.android.conf.json'), {
      identifier: branding.identifier
    })
  } catch {
    // Android config may not exist
  }

  // 3. Root package.json
  console.log('\n[3/7] Updating root package.json...')
  try {
    updateJsonFields(join(root, 'package.json'), {
      name: branding.rootPackageName
    })
  } catch {
    // package.json may not exist
  }

  // 4. Core package.json
  console.log('\n[4/7] Updating core package.json...')
  try {
    updateJsonFields(join(root, 'core', 'package.json'), {
      name: branding.corePackageName,
      homepage: branding.homepage,
      author: branding.author
    })
  } catch {
    // core may not exist
  }

  // 5. Web app index.html
  console.log('\n[5/7] Updating web app index.html...')
  const indexHtmlPath = join(root, 'web-app', 'index.html')
  try {
    let html = readFileSync(indexHtmlPath, 'utf-8')
    // Update <title>
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${branding.pageTitle}</title>`)
    // Update logo references
    html = html.replace(/\/images\/[^"]*logo[^"]*\.png/g, `/images/${branding.logoFilename}`)
    // Update logo alt text
    html = html.replace(/alt="[^"]*[Ll]ogo[^"]*"/, `alt="${branding.logoAlt}"`)
    writeFileSync(indexHtmlPath, html, 'utf-8')
    console.log(`  Updated: ${indexHtmlPath}`)
  } catch {
    // web-app may not exist
  }

  // 6. Locale files — update the "jan" key and "helpUsImproveJan" in all locales
  console.log('\n[6/7] Updating locale files...')
  const localesDir = join(root, 'web-app', 'src', 'locales')
  try {
    const localeDirs = readdirSync(localesDir)
    for (const locale of localeDirs) {
      const commonPath = join(localesDir, locale, 'common.json')
      try {
        let content = readFileSync(commonPath, 'utf-8')
        let updated = replaceJsonField(content, 'jan', branding.appName)
        // Update helpUsImproveJan value by replacing "Jan" inside its value
        updated = updated.replace(
          /("helpUsImproveJan"\s*:\s*)"([^"]*)"/,
          (match, prefix, value) => `${prefix}"${value.replace(/Jan/g, branding.appName)}"`
        )
        if (updated !== content) {
          writeFileSync(commonPath, updated, 'utf-8')
          console.log(`  Updated: ${commonPath}`)
        }
      } catch {
        // locale file may not exist
      }
    }
  } catch {
    // locales dir may not exist
  }

  // 7. Rust Cargo.toml (main package)
  console.log('\n[7/7] Updating Cargo.toml...')
  const cargoPath = join(root, 'src-tauri', 'Cargo.toml')
  try {
    let cargo = readFileSync(cargoPath, 'utf-8')
    cargo = cargo.replace(/^name = ".*"$/m, `name = "${branding.productName}"`)
    cargo = cargo.replace(/^authors = \[".*"\]$/m, `authors = ["${branding.author}"]`)
    cargo = cargo.replace(/^description = ".*"$/m, `description = "${branding.description}"`)
    cargo = cargo.replace(/^repository = ".*"$/m, `repository = "${branding.repository}"`)
    writeFileSync(cargoPath, cargo, 'utf-8')
    console.log(`  Updated: ${cargoPath}`)
  } catch {
    // Cargo.toml may not exist
  }

  console.log('\nBranding applied successfully!')
  console.log(`App is now branded as "${branding.appName}".`)
  console.log('See REBRANDING.md for additional manual steps (icons, URLs, etc.).')
}

// Run if invoked directly
const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith('rebrand.js') || process.argv[1].endsWith('rebrand.mjs'))

if (isMainModule) {
  const customPath = process.argv[2]
  applyBranding(customPath || undefined)
}
