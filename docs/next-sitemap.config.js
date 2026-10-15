/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://jan.ai/',
  generateRobotsTxt: true,
  // postbuild runs after the static export; emit into the uploaded directory,
  // not public/ (which Next already copied before this script runs).
  outDir: './out',
  changefreq: 'daily',
  priority: 1.0,
  // /tokamak is intentionally hidden (kept reachable but unlinked); keep it out
  // of the sitemap so it isn't surfaced for indexing.
  // Documentation now has its own canonical sitemap at docs.jan.ai.
  // Do not advertise old URLs that permanently redirect to the new host.
  exclude: ['/tokamak', '/docs', '/docs/*'],
}
