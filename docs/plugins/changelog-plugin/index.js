const fetchData = require('./fetchData');

module.exports = function (context, options) {
  const { siteConfig, isBuild } = context;

  // Fetch GitHub releases and generate markdown files
  fetchData(siteConfig)
    .then(() => {
      console.log('Changelog data fetched successfully.');
    })
    .catch((error) => {
      console.error('Error fetching GitHub releases:', error.message);
    });

  // Hook into Docusaurus lifecycle events
  return {
    name: 'changelog-plugin',
    async onPreBuild() {
      if (isBuild) {
        // Fetch GitHub releases and generate markdown files during the build
        // await fetchData(siteConfig);
      }
    },

    async onPostBuild() {
      // If you need additional actions after the build, you can include them here.
      await fetchData(siteConfig);
    },
  };
};
