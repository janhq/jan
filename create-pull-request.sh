#!/bin/bash

# Script to create a Pull Request for Spanish language support
# This script will create a PR from claude/add-spanish-language-011CUoMCCPrvSfShzYwnntZi to dev

set -e

BRANCH="claude/add-spanish-language-011CUoMCCPrvSfShzYwnntZi"
BASE_BRANCH="dev"
PR_TITLE="feat: Add Spanish (Español) Language Support 🌍"

echo "🚀 Creating Pull Request..."
echo ""
echo "From: ${BRANCH}"
echo "To: ${BASE_BRANCH}"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo ""
    echo "📋 Please create the PR manually using one of these methods:"
    echo ""
    echo "METHOD 1: Direct URL (Fastest)"
    echo "================================"
    echo "Open this URL in your browser:"
    echo ""
    echo "https://github.com/Danielsalamank/jan02/compare/dev...claude/add-spanish-language-011CUoMCCPrvSfShzYwnntZi?expand=1"
    echo ""
    echo "Then:"
    echo "1. Review the changes"
    echo "2. Click 'Create pull request'"
    echo "3. The title and description will be pre-filled"
    echo "4. Click 'Create pull request' again to confirm"
    echo ""
    echo "METHOD 2: GitHub Web Interface"
    echo "================================"
    echo "1. Go to: https://github.com/Danielsalamank/jan02"
    echo "2. Click on 'Pull requests' tab"
    echo "3. Click 'New pull request'"
    echo "4. Set base: dev"
    echo "5. Set compare: claude/add-spanish-language-011CUoMCCPrvSfShzYwnntZi"
    echo "6. Click 'Create pull request'"
    echo "7. Copy content from PR_DESCRIPTION.md"
    echo "8. Click 'Create pull request'"
    echo ""
    echo "METHOD 3: Install gh CLI"
    echo "================================"
    echo "Install from: https://cli.github.com/"
    echo "Then run this script again"
    echo ""
    exit 0
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub."
    echo "Please run: gh auth login"
    echo ""
    echo "Or use the manual method above"
    exit 1
fi

echo "✅ GitHub CLI is ready"
echo ""

# Create the PR
echo "📝 Creating pull request..."
echo ""

gh pr create \
    --base "${BASE_BRANCH}" \
    --head "${BRANCH}" \
    --title "${PR_TITLE}" \
    --body-file PR_DESCRIPTION.md \
    --web

echo ""
echo "✅ Pull request created successfully!"
echo ""
echo "🎉 Next steps:"
echo "1. Review the PR changes"
echo "2. Request reviews from team members (if needed)"
echo "3. Once approved, merge the PR"
echo "4. Create release v0.6.600"
echo "5. GitHub Actions will build installers automatically"
echo ""
