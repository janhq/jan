import google from 'googlethis'

const defaultOptions = {
  page: 0,
  safe: true, // Safe Search
  parse_ads: false, // If set to true sponsored results will be parsed
  additional_params: {
    // add additional parameters here, see https://moz.com/blog/the-ultimate-guide-to-the-google-search-parameters and https://www.seoquake.com/blog/google-search-param/
    hl: 'en',
  },
}

export const search = async (query: string, options: any = defaultOptions) => {
  const json_result = await google.search(query, options)
  const string_result = JSON.stringify(json_result)
  return string_result
}
