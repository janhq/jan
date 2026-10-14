#!/usr/bin/env node
/** Dependency-free regression tests: node --test scripts/test-checks.mjs */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scripts = dirname(fileURLToPath(import.meta.url))

test('redirect and channel checks work from paths with spaces and URL-special characters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs checks spaces # % '))
  const put = async (name, content) => {
    const file = join(root, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  const run = (script, { channel = 'stable', args = [], error } = {}) => {
    const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
      cwd: tmpdir(),
      env: { ...process.env, DOCS_CHANNEL: channel },
      encoding: 'utf8',
    })
    assert.ifError(result.error)
    const output = result.stdout + result.stderr
    if (error) {
      assert.notEqual(result.status, 0, output)
      assert.match(output, error)
    } else {
      assert.equal(result.status, 0, output)
    }
  }
  try {
    await mkdir(join(root, 'scripts'))
    for (const script of ['build-redirects.mjs', 'check-redirects.mjs', 'check-channel.mjs']) {
      await copyFile(join(scripts, script), join(root, 'scripts', script))
    }
    await put('content/index.mdx', '# Home')
    await put('content/desktop/quickstart.mdx', '# Quickstart')
    await put('redirects/legacy-jan.ai.txt', '/old /docs/desktop/quickstart 301\n')
    await put('redirects/old-docs-urls.txt', '/docs\n/docs/desktop/quickstart\n/old\n')
    await mkdir(join(root, 'public'))
    run('build-redirects.mjs')
    run('build-redirects.mjs', { args: ['--check'] })

    for (const channel of ['stable', 'nightly']) {
      const nightly = channel === 'nightly'
      const origin = nightly ? 'https://docs-nightly.jan.ai' : 'https://docs.jan.ai'
      const robots = `User-Agent: *\nAllow: /\n${nightly ? '' : `\nSitemap: ${origin}/sitemap.xml\n`}`
      const html = (url) => `<link rel="canonical" href="${url}"/>${nightly ? '<meta name="robots" content="noindex, nofollow"/><aside aria-label="Nightly documentation"><a href="https://docs.jan.ai">Stable</a></aside>' : ''}`
      await put('out/index.html', html(origin))
      await put('out/desktop/quickstart.html', html(`${origin}/desktop/quickstart`))
      await put('out/sitemap.xml', `<urlset><url><loc>${origin}</loc></url><url><loc>${origin}/desktop/quickstart</loc></url></urlset>`)
      await put('out/robots.txt', robots)
      run('check-redirects.mjs')
      run('check-channel.mjs', { channel })
      await put('out/robots.txt', robots.replace('Allow: /', 'Disallow: /'))
      run('check-channel.mjs', { channel, error: /Crawlers must be allowed/ })
      await put('out/robots.txt', robots.replace('Allow: /', 'Allow: /\nDisallow: /'))
      run('check-channel.mjs', { channel, error: /Crawlers must not be blocked/ })
      await put('out/robots.txt', nightly ? `${robots}\nSitemap: ${origin}/sitemap.xml\n` : 'User-Agent: *\nAllow: /\n')
      run('check-channel.mjs', { channel, error: nightly ? /must not advertise a sitemap/ : /Incorrect robots sitemap URL/ })
      if (nightly) {
        await put('out/robots.txt', robots)
        await put('out/index.html', html(origin).replace('noindex, nofollow', 'index, follow'))
        run('check-channel.mjs', { channel, error: /Missing noindex/ })
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
