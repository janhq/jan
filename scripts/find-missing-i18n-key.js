/**
 * Script to find missing i18n keys in Jan components
 *
 * Usage:
 *   node scripts/find-missing-i18n-key.js [options]
 *
 * Options:
 *   --locale=<locale>   Only check a specific locale (e.g. --locale=id)
 *   --file=<file>       Only check a specific file (e.g. --file=common.json)
 *   --help              Show this help message
 */

const fs = require('fs')
const path = require('path')

// Parse command-line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  if (arg === '--help') {
    acc.help = true
  } else if (arg.startsWith('--locale=')) {
    acc.locale = arg.split('=')[1]
  } else if (arg.startsWith('--file=')) {
    acc.file = arg.split('=')[1]
  }
  return acc
}, {})

// Display help information
if (args.help) {
  console.log(`
Find missing i18n translations in Jan

A useful script to identify whether the i18n keys used in component files exist in all language files.

Usage:
  node scripts/find-missing-i18n-key.js [options]

Options:
  --locale=<locale>   Only check a specific language (e.g., --locale=id)
  --file=<file>       Only check a specific file (e.g., --file=common.json)
  --help              Display help information

Output:
  - Generate a report of missing translations
  `)
  process.exit(0)
}

// Directories to traverse and their corresponding locales
const DIRS = {
  components: {
    path: path.join(__dirname, '../web-app/src/components'),
    localesDir: path.join(__dirname, '../web-app/src/locales'),
  },
  containers: {
    path: path.join(__dirname, '../web-app/src/containers'),
    localesDir: path.join(__dirname, '../web-app/src/locales'),
  },
  routes: {
    path: path.join(__dirname, '../web-app/src/routes'),
    localesDir: path.join(__dirname, '../web-app/src/locales'),
  },
}

// Regular expressions to match i18n keys
const i18nPatterns = [
  /{t\("([^"]+)"\)}/g, // Match {t("key")} format
  /i18nKey="([^"]+)"/g, // Match i18nKey="key" format
  /\bt\(\s*["']([^"']+)["']\s*(?:,\s*[^)]+)?\)/g, // Match t("key") format with optional parameters - simplified and more robust
]

// Get all language directories for a specific locales directory
function getLocaleDirs(localesDir) {
  try {
    const allLocales = fs.readdirSync(localesDir).filter((file) => {
      const stats = fs.statSync(path.join(localesDir, file))
      return stats.isDirectory() // Do not exclude any language directories
    })

    // Filter to a specific language if specified
    return args.locale
      ? allLocales.filter((locale) => locale === args.locale)
      : allLocales
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`Warning: Locales directory not found: ${localesDir}`)
      return []
    }
    throw error
  }
}

// Get the value from JSON by path
function getValueByPath(obj, path) {
  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = current[part]
  }

  return current
}

// Check if the key exists in all language files, return a list of missing language files
function checkKeyInLocales(key, localeDirs, localesDir) {
  // Handle namespace:key format (e.g., "common:save" or "settings:general")
  let namespace, keyPath

  if (key.includes(':')) {
    ;[namespace, keyPath] = key.split(':', 2)
  } else if (key.includes('.')) {
    // Handle namespace.key format
    const parts = key.split('.')

    // Check if the first part is a known namespace
    const knownNamespaces = [
      'common',
      'settings',
      'systemMonitor',
      'chat',
      'hub',
      'providers',
      'assistants',
      'mcpServers',
      'mcp-servers',
      'toolApproval',
      'tool-approval',
      'updater',
      'setup',
      'logs',
      'provider',
      'model-errors',
    ]

    if (knownNamespaces.includes(parts[0])) {
      namespace = parts[0]
      keyPath = parts.slice(1).join('.')
    } else {
      // Default to common namespace if no known namespace is found
      namespace = 'common'
      keyPath = key
    }
  } else {
    // No dots, default to common namespace
    namespace = 'common'
    keyPath = key
  }

  const missingLocales = []

  // Map namespace to actual filename
  const namespaceToFile = {
    'systemMonitor': 'system-monitor',
    'mcpServers': 'mcp-servers',
    'mcp-servers': 'mcp-servers',
    'toolApproval': 'tool-approval',
    'tool-approval': 'tool-approval',
    'model-errors': 'model-errors',
  }

  const fileName = namespaceToFile[namespace] || namespace

  localeDirs.forEach((locale) => {
    const filePath = path.join(localesDir, locale, `${fileName}.json`)
    if (!fs.existsSync(filePath)) {
      missingLocales.push(`${locale}/${fileName}.json`)
      return
    }

    try {
      const json = JSON.parse(fs.readFileSync(filePath, 'utf8'))

      // Jan's localization files have flat structure
      // e.g., common.json has { "save": "Save", "cancel": "Cancel" }
      // not nested like { "common": { "save": "Save" } }
      const valueToCheck = getValueByPath(json, keyPath)

      if (valueToCheck === undefined) {
        missingLocales.push(`${locale}/${fileName}.json`)
      }
    } catch (error) {
      console.warn(`Warning: Could not parse ${filePath}: ${error.message}`)
      missingLocales.push(`${locale}/${fileName}.json`)
    }
  })

  return missingLocales
}

// Recursively traverse the directory
function findMissingI18nKeys() {
  const results = []

  function walk(dir, baseDir, localeDirs, localesDir) {
    if (!fs.existsSync(dir)) {
      console.warn(`Warning: Directory not found: ${dir}`)
      return
    }

    const files = fs.readdirSync(dir)

    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      // Exclude test files, __mocks__ directory, and node_modules
      if (
        filePath.includes('.test.') ||
        filePath.includes('__mocks__') ||
        filePath.includes('node_modules') ||
        filePath.includes('.spec.')
      ) {
        continue
      }

      if (stat.isDirectory()) {
        walk(filePath, baseDir, localeDirs, localesDir) // Recursively traverse subdirectories
      } else if (
        stat.isFile() &&
        ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(filePath))
      ) {
        const content = fs.readFileSync(filePath, 'utf8')

        // Match all i18n keys
        for (const pattern of i18nPatterns) {
          let match
          while ((match = pattern.exec(content)) !== null) {
            const key = match[1]

            // Skip empty keys or keys that look like variables/invalid
            if (
              !key ||
              key.includes('${') ||
              key.includes('{{') ||
              key.startsWith('$') ||
              key.length < 2 ||
              key === '.' ||
              key === ',' ||
              key === '-' ||
              !/^[a-zA-Z]/.test(key)
            ) {
              continue
            }

            const missingLocales = checkKeyInLocales(
              key,
              localeDirs,
              localesDir
            )
            if (missingLocales.length > 0) {
              results.push({
                key,
                missingLocales,
                file: path.relative(baseDir, filePath),
              })
            }
          }
        }
      }
    }
  }

  // Walk through all directories
  Object.entries(DIRS).forEach(([name, config]) => {
    const localeDirs = getLocaleDirs(config.localesDir)
    if (localeDirs.length > 0) {
      console.log(
        `\nChecking ${name} directory with ${
          localeDirs.length
        } languages: ${localeDirs.join(', ')}`
      )
      walk(config.path, config.path, localeDirs, config.localesDir)
    }
  })

  return results
}

// Execute and output the results
function main() {
  try {
    if (args.locale) {
      // Check if the specified locale exists in the locales directory
      const localesDir = path.join(__dirname, '../web-app/src/locales')
      const localeDirs = getLocaleDirs(localesDir)

      if (!localeDirs.includes(args.locale)) {
        console.error(
          `Error: Language '${args.locale}' not found in ${localesDir}`
        )
        process.exit(1)
      }
    }

    const missingKeys = findMissingI18nKeys()

    if (missingKeys.length === 0) {
      console.log('\n✅ All i18n keys are present!')
      return
    }

    console.log('\nMissing i18n keys:\n')

    // Group by file for better readability
    const groupedByFile = {}
    missingKeys.forEach(({ key, missingLocales, file }) => {
      if (!groupedByFile[file]) {
        groupedByFile[file] = []
      }
      groupedByFile[file].push({ key, missingLocales })
    })

    Object.entries(groupedByFile).forEach(([file, keys]) => {
      console.log(`📁 File: ${file}`)
      keys.forEach(({ key, missingLocales }) => {
        console.log(`  🔑 Key: ${key}`)
        console.log('  ❌ Missing in:')
        missingLocales.forEach((locale) => console.log(`    - ${locale}`))
        console.log('')
      })
      console.log('-------------------')
    })

    console.log('\n💡 To fix missing translations:')
    console.log('1. Add the missing keys to the appropriate locale files')
    console.log('2. Use yq commands for efficient updates:')
    console.log(
      '   yq -i \'.namespace.key = "Translation"\' web-app/src/locales/<locale>/<file>.json'
    )
    console.log('3. Run this script again to verify all keys are present')

    // Exit code 1 indicates missing keys
    process.exit(1)
  } catch (error) {
    console.error('Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

main()
