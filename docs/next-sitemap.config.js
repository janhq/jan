/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://jan.ai/',
  generateRobotsTxt: true,
  changefreq: 'daily',
  priority: 1.0,
  // /tokamak is intentionally hidden (kept reachable but unlinked); keep it out
  // of the sitemap so it isn't surfaced for indexing.
  exclude: ['/tokamak'],
}
