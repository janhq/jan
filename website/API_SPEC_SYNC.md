# API Specification Synchronization

This document explains how the Jan Server API specification is kept in sync with the documentation.

## Overview

The Jan documentation automatically synchronizes with the Jan Server API specification to ensure the API reference is always up to date. This is managed through GitHub Actions workflows that can be triggered in multiple ways.

## Synchronization Methods

### 1. Automatic Daily Sync
- **Schedule**: Runs daily at 2 AM UTC
- **Branch**: `dev`
- **Behavior**: Fetches the latest spec and commits changes if any
- **Workflow**: `.github/workflows/update-cloud-api-spec.yml`

### 2. Manual Trigger via GitHub UI
Navigate to Actions → "Update Cloud API Spec" → Run workflow

Options:
- **Commit changes**: Whether to commit changes directly (default: true)
- **Custom spec URL**: Override the default API spec URL
- **Create PR**: Create a pull request instead of direct commit (default: false)

### 3. Webhook Trigger (For Jan Server Team)

Send a repository dispatch event to trigger an update:

```bash
curl -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token YOUR_GITHUB_TOKEN" \
  https://api.github.com/repos/janhq/jan/dispatches \
  -d '{
    "event_type": "update-api-spec",
    "client_payload": {
      "spec_url": "https://api.jan.ai/api/swagger/doc.json"
    }
  }'
```

### 4. Local Development

For local development, the spec is updated conditionally:

```bash
# Force update the cloud spec
bun run generate:cloud-spec-force

# Normal update (checks if update is needed)
bun run generate:cloud-spec

# Update both local and cloud specs
bun run generate:specs
```

## Configuration

### Environment Variables

The following environment variables can be configured in GitHub Secrets:

| Variable | Description | Default |
|----------|-------------|---------|
| `JAN_SERVER_SPEC_URL` | URL to fetch the OpenAPI spec | `https://api.jan.ai/api/swagger/doc.json` |
| `JAN_SERVER_PROD_URL` | Production API base URL | `https://api.jan.ai/v1` |
| `JAN_SERVER_STAGING_URL` | Staging API base URL | `https://staging-api.jan.ai/v1` |

### Build Behavior

| Context | Behavior |
|---------|----------|
| Pull Request | Uses existing spec (no update) |
| Push to dev | Uses existing spec (no update) |
| Scheduled run | Updates spec and commits changes |
| Manual trigger | Updates based on input options |
| Webhook | Updates and creates PR |
| Local dev | Updates if spec is >24hrs old or missing |

## Workflow Integration

### For Jan Server Team

When deploying a new API version:

1. **Option A: Automatic PR**
   - Deploy your API changes
   - Trigger the webhook (see above)
   - Review and merge the created PR

2. **Option B: Manual Update**
   - Go to [Actions](https://github.com/janhq/jan/actions/workflows/update-cloud-api-spec.yml)
   - Click "Run workflow"
   - Select options:
     - Set "Create PR" to `true` for review
     - Or leave as `false` for direct commit

3. **Option C: Wait for Daily Sync**
   - Changes will be picked up automatically at 2 AM UTC

### For Documentation Team

The API spec updates are handled automatically. However, you can:

1. **Force an update**: Run the "Update Cloud API Spec" workflow manually
2. **Test locally**: Use `bun run generate:cloud-spec-force`
3. **Review changes**: Check PRs labeled with `api` and `automated`

## Fallback Mechanism

If the Jan Server API is unavailable:

1. The workflow will use the last known good spec
2. Local builds will fall back to the local OpenAPI spec
3. The build will continue without failing

## Monitoring

### Check Update Status

1. Go to [Actions](https://github.com/janhq/jan/actions/workflows/update-cloud-api-spec.yml)
2. Check the latest run status
3. Review the workflow summary for details

### Notifications

To add Slack/Discord notifications:

1. Add webhook URL to GitHub Secrets
2. Uncomment notification section in workflow
3. Configure message format as needed

## Troubleshooting

### Spec Update Fails

1. Check if the API endpoint is accessible
2. Verify the spec URL is correct
3. Check GitHub Actions logs for errors
4. Ensure proper permissions for the workflow

### Changes Not Appearing

1. Verify the workflow completed successfully
2. Check if changes were committed to the correct branch
3. Ensure the build is using the updated spec
4. Clear CDN cache if using Cloudflare

### Manual Recovery

If automated updates fail:

```bash
# Clone the repository
git clone https://github.com/janhq/jan.git
cd jan/website

# Install dependencies
bun install

# Force update the spec
FORCE_UPDATE=true bun run generate:cloud-spec

# Commit and push
git add public/openapi/cloud-openapi.json
git commit -m "chore: manual update of API spec"
git push
```

## Best Practices

1. **Version Control**: Always review significant API changes before merging
2. **Testing**: Test the updated spec locally before deploying
3. **Communication**: Notify the docs team of breaking API changes
4. **Monitoring**: Set up alerts for failed spec updates
5. **Documentation**: Update this guide when changing the sync process

## Support

For issues or questions:
- Open an issue in the [Jan repository](https://github.com/janhq/jan/issues)
- Contact the documentation team on Discord
- Check the [workflow runs](https://github.com/janhq/jan/actions) for debugging