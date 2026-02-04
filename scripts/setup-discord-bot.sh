#!/bin/bash
# Discord Bot Setup Helper for Jan Desktop
# Run this script to configure the Discord bot via CLI
#
# Usage:
#   ./scripts/setup-discord-bot.sh

echo "============================================"
echo "  Discord Bot Setup for Jan Desktop"
echo "============================================"
echo ""

# Check if .env file exists
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env file..."
    touch "$ENV_FILE"
fi

echo "Step 1: Get your Discord Bot Token"
echo "   1. Go to https://discord.com/developers/applications"
echo "   2. Create/select your app"
echo "   3. Go to 'Bot' section"
echo "   4. Click 'Reset Token' if needed"
echo "   5. Copy the token"
echo ""

echo -n "Paste your Bot Token: "
read -r bot_token

if [ -z "$bot_token" ]; then
    echo "Error: Bot token is required"
    exit 1
fi

echo ""
echo "Step 2: Get your Bot User ID"
echo "   1. Enable Developer Mode in Discord (Settings -> Advanced -> Developer Mode)"
echo "   2. Right-click your bot in the member list"
echo "   3. Click 'Copy ID'"
echo ""

echo -n "Paste your Bot User ID: "
read -r bot_user_id

if [ -z "$bot_user_id" ]; then
    echo "Error: Bot User ID is required"
    exit 1
fi

echo ""
echo "Step 3: Get your Channel ID"
echo "   1. Right-click the text channel you want the bot to use"
echo "   2. Click 'Copy ID'"
echo ""

echo -n "Paste your Channel ID: "
read -r channel_id

if [ -z "$channel_id" ]; then
    echo "Error: Channel ID is required"
    exit 1
fi

# Save to .env
echo "" >> "$ENV_FILE"
echo "# Discord Bot Configuration - $(date)" >> "$ENV_FILE"
echo "DISCORD_BOT_TOKEN=$bot_token" >> "$ENV_FILE"
echo "DISCORD_BOT_USER_ID=$bot_user_id" >> "$ENV_FILE"
echo "DISCORD_CHANNEL_ID=$channel_id" >> "$ENV_FILE"

echo ""
echo "============================================"
echo "  Configuration Saved!"
echo "============================================"
echo ""
echo "Saved to: $ENV_FILE"
echo ""
echo "IMPORTANT:"
echo "  - Never commit $ENV_FILE to git!"
echo "  - Add $ENV_FILE to .gitignore"
echo ""
echo "Next steps:"
echo "  1. Restart Jan Desktop"
echo "  2. Go to Gateway Settings"
echo "  3. Enter the Discord credentials in the Discord Settings panel"
echo ""
