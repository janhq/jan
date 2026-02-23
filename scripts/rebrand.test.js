import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyBranding } from '../scripts/rebrand.js'

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

describe('rebrand script', () => {
  let tempDir

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rebrand-test-'))

    // Create minimal directory structure
    mkdirSync(join(tempDir, 'src-tauri'), { recursive: true })
    mkdirSync(join(tempDir, 'core'), { recursive: true })
    mkdirSync(join(tempDir, 'web-app', 'src', 'locales', 'en'), { recursive: true })
    mkdirSync(join(tempDir, 'web-app', 'src', 'locales', 'fr'), { recursive: true })

    // Create source files with "Jan" branding
    writeJson(join(tempDir, 'src-tauri', 'tauri.conf.json'), {
      productName: 'Jan',
      identifier: 'jan.ai.app',
      bundle: { publisher: 'Menlo Research Pte. Ltd.' }
    })

    writeJson(join(tempDir, 'src-tauri', 'tauri.linux.conf.json'), {
      app: { windows: [{ title: 'Jan' }] }
    })

    writeJson(join(tempDir, 'src-tauri', 'tauri.macos.conf.json'), {
      app: { windows: [{ title: 'Jan' }] }
    })

    writeJson(join(tempDir, 'src-tauri', 'tauri.windows.conf.json'), {
      app: { windows: [{ title: 'Jan' }] }
    })

    writeJson(join(tempDir, 'src-tauri', 'tauri.ios.conf.json'), {
      identifier: 'jan.ai.app.ios'
    })

    writeJson(join(tempDir, 'src-tauri', 'tauri.android.conf.json'), {
      identifier: 'jan.ai.app'
    })

    writeJson(join(tempDir, 'package.json'), { name: 'jan-app' })

    writeJson(join(tempDir, 'core', 'package.json'), {
      name: '@janhq/core',
      homepage: 'https://jan.ai',
      author: 'Jan <service@jan.ai>',
      description: 'Core library for the Jan AI application framework'
    })

    writeFileSync(join(tempDir, 'web-app', 'index.html'), [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<link rel="icon" href="/images/jan-logo.png" />',
      '<title>Jan</title>',
      '</head>',
      '<body>',
      '<img src="/images/jan-logo.png" alt="Jan Logo" />',
      '</body>',
      '</html>'
    ].join('\n'))

    writeJson(join(tempDir, 'web-app', 'src', 'locales', 'en', 'common.json'), {
      jan: 'Jan',
      helpUsImproveJan: 'Help Us Improve Jan'
    })

    writeJson(join(tempDir, 'web-app', 'src', 'locales', 'fr', 'common.json'), {
      jan: 'Jan',
      helpUsImproveJan: 'Aidez-nous à améliorer Jan'
    })

    writeFileSync(join(tempDir, 'src-tauri', 'Cargo.toml'), [
      '[package]',
      'name = "Jan"',
      'version = "0.6.599"',
      'description = "Use offline LLMs with your own data."',
      'authors = ["Jan <service@jan.ai>"]',
      'repository = "https://github.com/janhq/jan"',
      'edition = "2021"',
      ''
    ].join('\n'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should update tauri.conf.json productName and identifier', () => {
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Acme',
      productName: 'Acme',
      identifier: 'com.acme.app',
      identifierIos: 'com.acme.app.ios',
      author: 'Acme <hi@acme.com>',
      publisher: 'Acme Inc.',
      homepage: 'https://acme.com',
      repository: 'https://github.com/acme/acme',
      description: 'Acme AI assistant.',
      packageScope: '@acme',
      rootPackageName: 'acme-app',
      corePackageName: '@acme/core',
      webAppPackageName: '@acme/web-app',
      pageTitle: 'Acme',
      logoFilename: 'acme-logo.png',
      logoAlt: 'Acme Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    const tauriConf = readJson(join(tempDir, 'src-tauri', 'tauri.conf.json'))
    expect(tauriConf.productName).toBe('Acme')
    expect(tauriConf.identifier).toBe('com.acme.app')
    expect(tauriConf.bundle.publisher).toBe('Acme Inc.')
  })

  it('should update platform-specific window titles', () => {
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Acme',
      productName: 'Acme',
      identifier: 'com.acme.app',
      identifierIos: 'com.acme.app.ios',
      author: 'Acme <hi@acme.com>',
      publisher: 'Acme Inc.',
      homepage: 'https://acme.com',
      repository: 'https://github.com/acme/acme',
      description: 'Acme AI assistant.',
      packageScope: '@acme',
      rootPackageName: 'acme-app',
      corePackageName: '@acme/core',
      webAppPackageName: '@acme/web-app',
      pageTitle: 'Acme',
      logoFilename: 'acme-logo.png',
      logoAlt: 'Acme Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    for (const platform of ['linux', 'macos', 'windows']) {
      const conf = readJson(join(tempDir, 'src-tauri', `tauri.${platform}.conf.json`))
      expect(conf.app.windows[0].title).toBe('Acme')
    }
  })

  it('should update mobile configs', () => {
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Acme',
      productName: 'Acme',
      identifier: 'com.acme.app',
      identifierIos: 'com.acme.app.ios',
      author: 'Acme <hi@acme.com>',
      publisher: 'Acme Inc.',
      homepage: 'https://acme.com',
      repository: 'https://github.com/acme/acme',
      description: 'Acme AI assistant.',
      packageScope: '@acme',
      rootPackageName: 'acme-app',
      corePackageName: '@acme/core',
      webAppPackageName: '@acme/web-app',
      pageTitle: 'Acme',
      logoFilename: 'acme-logo.png',
      logoAlt: 'Acme Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    const iosConf = readJson(join(tempDir, 'src-tauri', 'tauri.ios.conf.json'))
    expect(iosConf.identifier).toBe('com.acme.app.ios')

    const androidConf = readJson(join(tempDir, 'src-tauri', 'tauri.android.conf.json'))
    expect(androidConf.identifier).toBe('com.acme.app')
  })

  it('should update root and core package.json', () => {
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Acme',
      productName: 'Acme',
      identifier: 'com.acme.app',
      identifierIos: 'com.acme.app.ios',
      author: 'Acme <hi@acme.com>',
      publisher: 'Acme Inc.',
      homepage: 'https://acme.com',
      repository: 'https://github.com/acme/acme',
      description: 'Acme AI assistant.',
      packageScope: '@acme',
      rootPackageName: 'acme-app',
      corePackageName: '@acme/core',
      webAppPackageName: '@acme/web-app',
      pageTitle: 'Acme',
      logoFilename: 'acme-logo.png',
      logoAlt: 'Acme Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    const rootPkg = readJson(join(tempDir, 'package.json'))
    expect(rootPkg.name).toBe('acme-app')

    const corePkg = readJson(join(tempDir, 'core', 'package.json'))
    expect(corePkg.name).toBe('@acme/core')
    expect(corePkg.homepage).toBe('https://acme.com')
    expect(corePkg.author).toBe('Acme <hi@acme.com>')
    // description is not updated by rebrand (only Cargo.toml description is)
    expect(corePkg.description).toBe('Core library for the Jan AI application framework')
  })

  it('should update web app index.html title and logo references', () => {
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Acme',
      productName: 'Acme',
      identifier: 'com.acme.app',
      identifierIos: 'com.acme.app.ios',
      author: 'Acme <hi@acme.com>',
      publisher: 'Acme Inc.',
      homepage: 'https://acme.com',
      repository: 'https://github.com/acme/acme',
      description: 'Acme AI assistant.',
      packageScope: '@acme',
      rootPackageName: 'acme-app',
      corePackageName: '@acme/core',
      webAppPackageName: '@acme/web-app',
      pageTitle: 'Acme',
      logoFilename: 'acme-logo.png',
      logoAlt: 'Acme Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    const html = readFileSync(join(tempDir, 'web-app', 'index.html'), 'utf-8')
    expect(html).toContain('<title>Acme</title>')
    expect(html).toContain('/images/acme-logo.png')
    expect(html).toContain('alt="Acme Logo"')
    expect(html).not.toContain('Jan')
  })

  it('should update locale files', () => {
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Acme',
      productName: 'Acme',
      identifier: 'com.acme.app',
      identifierIos: 'com.acme.app.ios',
      author: 'Acme <hi@acme.com>',
      publisher: 'Acme Inc.',
      homepage: 'https://acme.com',
      repository: 'https://github.com/acme/acme',
      description: 'Acme AI assistant.',
      packageScope: '@acme',
      rootPackageName: 'acme-app',
      corePackageName: '@acme/core',
      webAppPackageName: '@acme/web-app',
      pageTitle: 'Acme',
      logoFilename: 'acme-logo.png',
      logoAlt: 'Acme Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    const en = readJson(join(tempDir, 'web-app', 'src', 'locales', 'en', 'common.json'))
    expect(en.jan).toBe('Acme')
    expect(en.helpUsImproveJan).toBe('Help Us Improve Acme')

    const fr = readJson(join(tempDir, 'web-app', 'src', 'locales', 'fr', 'common.json'))
    expect(fr.jan).toBe('Acme')
    expect(fr.helpUsImproveJan).toBe('Aidez-nous à améliorer Acme')
  })

  it('should update Cargo.toml', () => {
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Acme',
      productName: 'Acme',
      identifier: 'com.acme.app',
      identifierIos: 'com.acme.app.ios',
      author: 'Acme <hi@acme.com>',
      publisher: 'Acme Inc.',
      homepage: 'https://acme.com',
      repository: 'https://github.com/acme/acme',
      description: 'Acme AI assistant.',
      packageScope: '@acme',
      rootPackageName: 'acme-app',
      corePackageName: '@acme/core',
      webAppPackageName: '@acme/web-app',
      pageTitle: 'Acme',
      logoFilename: 'acme-logo.png',
      logoAlt: 'Acme Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    const cargo = readFileSync(join(tempDir, 'src-tauri', 'Cargo.toml'), 'utf-8')
    expect(cargo).toContain('name = "Acme"')
    expect(cargo).toContain('authors = ["Acme <hi@acme.com>"]')
    expect(cargo).toContain('description = "Acme AI assistant."')
    expect(cargo).toContain('repository = "https://github.com/acme/acme"')
  })

  it('should be idempotent when run with same branding', () => {
    // Use the default Jan branding
    writeJson(join(tempDir, 'branding.json'), {
      appName: 'Jan',
      productName: 'Jan',
      identifier: 'jan.ai.app',
      identifierIos: 'jan.ai.app.ios',
      author: 'Jan <service@jan.ai>',
      publisher: 'Menlo Research Pte. Ltd.',
      homepage: 'https://jan.ai',
      repository: 'https://github.com/janhq/jan',
      description: 'Use offline LLMs with your own data.',
      packageScope: '@janhq',
      rootPackageName: 'jan-app',
      corePackageName: '@janhq/core',
      webAppPackageName: '@janhq/web-app',
      pageTitle: 'Jan',
      logoFilename: 'jan-logo.png',
      logoAlt: 'Jan Logo'
    })

    applyBranding(join(tempDir, 'branding.json'))

    // Verify nothing broke
    const tauriConf = readJson(join(tempDir, 'src-tauri', 'tauri.conf.json'))
    expect(tauriConf.productName).toBe('Jan')

    const rootPkg = readJson(join(tempDir, 'package.json'))
    expect(rootPkg.name).toBe('jan-app')
  })
})
