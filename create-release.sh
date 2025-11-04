#!/bin/bash

# Script to create release v0.6.600 with Spanish language support
# This script will create a GitHub release using gh CLI

set -e

VERSION="v0.6.600"
RELEASE_TITLE="Release v0.6.600 - Spanish Language Support 🌍"
BRANCH="claude/add-spanish-language-011CUoMCCPrvSfShzYwnntZi"

echo "🚀 Creating release ${VERSION} for Jan with Spanish language support..."
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo ""
    echo "Please install it from: https://cli.github.com/"
    echo ""
    echo "Or create the release manually:"
    echo "1. Go to https://github.com/Danielsalamank/jan02/releases/new"
    echo "2. Tag: ${VERSION}"
    echo "3. Target: ${BRANCH}"
    echo "4. Title: ${RELEASE_TITLE}"
    echo "5. Copy content from RELEASE_NOTES_v0.6.600.md"
    echo "6. Click 'Publish release'"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub."
    echo "Please run: gh auth login"
    exit 1
fi

echo "✅ GitHub CLI is ready"
echo ""

# Create and push tag if it doesn't exist
if ! git rev-parse ${VERSION} >/dev/null 2>&1; then
    echo "📝 Creating tag ${VERSION}..."
    git tag -a ${VERSION} -m "Release ${VERSION} - Spanish Language Support"

    echo "📤 Pushing tag to GitHub..."
    git push origin ${VERSION}
else
    echo "✅ Tag ${VERSION} already exists"
fi

echo ""
echo "🎉 Creating GitHub release..."
echo ""

# Create the release
gh release create ${VERSION} \
    --title "${RELEASE_TITLE}" \
    --notes-file RELEASE_NOTES_v0.6.600.md \
    --target ${BRANCH} \
    --draft

echo ""
echo "✅ Draft release created successfully!"
echo ""
echo "📋 Next steps:"
echo "1. GitHub Actions will automatically build installers for:"
echo "   - Windows (.exe and .msi)"
echo "   - macOS (universal .dmg)"
echo "   - Linux (.AppImage and .deb)"
echo ""
echo "2. Wait for the build to complete (~30-40 minutes)"
echo ""
echo "3. Review the draft release at:"
echo "   https://github.com/Danielsalamank/jan02/releases"
echo ""
echo "4. When builds are complete, publish the release!"
echo ""
echo "🎊 Your Spanish language release is ready to go!"
