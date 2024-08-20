module.exports = {
  plugins: {
    'tailwindcss': {},
    'autoprefixer': {},
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'postcss-url': {
      url: (asset) => {
        if (asset.url.startsWith('./_next/static/media/')) {
          return asset.url.replace(
            './_next/static/media/',
            '/_next/static/media/'
          )
        }
        // Leave other assets as they are
        return asset.url
      },
    },
  },
}
