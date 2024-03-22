const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

async function fetchData(siteConfig, forceRefresh = false) {
  const owner = siteConfig.organizationName;
  const repo = siteConfig.projectName;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;

  const outputDirectory = path.join(__dirname, '../../docs/releases/changelog');

  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory);
  }

  let counter = 1;
  const cacheFilePath = path.join(outputDirectory, 'cache.json');

  let cachedData = {};
  if (fs.existsSync(cacheFilePath) && !forceRefresh) {
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
    if (cachedData.releases && !forceRefresh) {
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

  // Check if there are new releases
  const newReleases = releases.filter(release => {
    const version = release.tag_name;
    const existingChangelogPath = path.join(outputDirectory, `changelog-${version}.mdx`);
    return !fs.existsSync(existingChangelogPath);
  });

  // If there are new releases, update existing changelog files' sidebar positions
  if (newReleases.length > 0) {
    console.log(`Updating sidebar positions for ${newReleases.length} new releases...`);
    const existingChangelogFiles = fs.readdirSync(outputDirectory)
      .filter(file => file.startsWith('changelog-'));

    existingChangelogFiles.forEach((filename, index) => {
      const version = filename.substring(10, filename.length - 4);
      const existingChangelogPath = path.join(outputDirectory, filename);
      const content = fs.readFileSync(existingChangelogPath, 'utf-8');
      const sidebarPositionMatch = content.match(/sidebar_position: (\d+)/);
      let sidebarPosition = index + 1;

      if (sidebarPositionMatch) {
        sidebarPosition = parseInt(sidebarPositionMatch[1]);
      }

      const updatedContent = content.replace(/sidebar_position: (\d+)/, `sidebar_position: ${sidebarPosition}`);
      fs.writeFileSync(existingChangelogPath, updatedContent, 'utf-8');
      console.log(`Sidebar position updated for changelog-${version}`);
    });
  }

  // Process the GitHub releases data here
  for (const release of releases) {
    const version = release.tag_name;

    // Check if the changelog file already exists for the current version
    const existingChangelogPath = path.join(outputDirectory, `changelog-${version}.mdx`);
    if (fs.existsSync(existingChangelogPath)) {
      console.log(`Changelog for version ${version} already exists. Skipping...`);
      continue;
    }

    const releaseUrl = release.html_url;
    const issueNumberMatch = release.body.match(/#(\d+)/);
    const issueNumber = issueNumberMatch ? parseInt(issueNumberMatch[1], 10) : null;

    let issueLink = '';
    if (issueNumber) {
      const issueDetails = await getIssueDetails(issueNumber);
      issueLink = ` [Issue #${issueNumber}: ${issueDetails.title}](${issueDetails.html_url})`;
    }

    const changes = release.body;

    let markdownContent = `---\nsidebar_position: ${counter}\nslug: /changelog/changelog-${version}\n---\n# ${version}\n\nFor more details, [GitHub Issues](${releaseUrl})\n\nHighlighted Issue: ${issueLink}\n\n${changes}\n`;

    // Write to a separate markdown file for each version
    const outputFilePath = path.join(outputDirectory, `changelog-${version}.mdx`);
    fs.writeFileSync(outputFilePath, markdownContent, 'utf-8');

    console.log(`Changelog for version ${version} has been exported to: ${outputFilePath}`);

    counter++;
  }
}

module.exports = fetchData;
