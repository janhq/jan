const fs = require('fs');
const path = require('path');

async function fetchData(siteConfig) {
  const owner = siteConfig.organizationName;
  const repo = siteConfig.projectName;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;

  const outputDirectory = path.join(__dirname, '../../docs/guides/changelogs');

  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory);
  }

  let counter = 1;
  const categoryFilePath = path.join(outputDirectory, '_category_.json');
  const cacheFilePath = path.join(outputDirectory, 'cache.json');

  let cachedData = {};
  if (fs.existsSync(cacheFilePath)) {
    cachedData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
  }

  // Function to retrieve issue details from GitHub API
  async function getIssueDetails(issueNumber) {
    const issueApiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const response = await fetch(issueApiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return response.json();
  }

  // Fetch releases from GitHub API or load from cache
  let releases = [];
  try {
    if (cachedData.releases) {
      console.log('Loading releases from cache...');
      releases = cachedData.releases;
    } else {
      console.log('Fetching releases from GitHub API...');
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github+json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      releases = await response.json();
      // Cache the fetched releases
      cachedData.releases = releases;
      fs.writeFileSync(cacheFilePath, JSON.stringify(cachedData, null, 2), 'utf-8');
      console.log(`Fetched releases saved to cache: ${cacheFilePath}`);
    }
  } catch (error) {
    console.error('Error fetching GitHub releases:', error.message);
    return;
  }

  // Process the GitHub releases data here
  for (const release of releases) {
    const version = release.tag_name;
    const releaseUrl = release.html_url;
    const issueNumberMatch = release.body.match(/#(\d+)/);
    const issueNumber = issueNumberMatch ? parseInt(issueNumberMatch[1], 10) : null;

    let issueLink = '';
    if (issueNumber) {
      const issueDetails = await getIssueDetails(issueNumber);
      issueLink = ` [Issue #${issueNumber}: ${issueDetails.title}](${issueDetails.html_url})`;
    }

    const changes = release.body;

    let markdownContent = `---\nsidebar_position: ${counter}\n---\n# ${version}\n\nFor more details, [GitHub Issues](${releaseUrl})\n\nHighlighted Issue: ${issueLink}\n\n${changes}\n`;

    // Write to a separate markdown file for each version
    const outputFilePath = path.join(outputDirectory, `changelog-${version}.mdx`);
    fs.writeFileSync(outputFilePath, markdownContent, 'utf-8');

    console.log(`Changelog for version ${version} has been exported to: ${outputFilePath}`);

    counter++;
  }

  // Create _category_.json file
  const categoryContent = {
    label: 'Changelogs',
    position: 5,
    link: {
      type: 'generated-index',
      description: 'Changelog for Jan',
    },
  };

  fs.writeFileSync(categoryFilePath, JSON.stringify(categoryContent, null, 2), 'utf-8');

  console.log(`_category_.json has been created at: ${categoryFilePath}`);
}

module.exports = fetchData;
