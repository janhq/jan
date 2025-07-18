#!/bin/bash
# macOS post-test cleanup script

echo "Cleaning up after tests..."

# Kill any running Jan processes (both regular and nightly)
pkill -f "Jan" || true
pkill -f "jan" || true
pkill -f "Jan-nightly" || true
pkill -f "jan-nightly" || true

# Remove Jan app directories
rm -rf /Applications/Jan.app
rm -rf /Applications/Jan-nightly.app
rm -rf ~/Applications/Jan.app
rm -rf ~/Applications/Jan-nightly.app

# Remove Jan data folders (both regular and nightly)
rm -rf ~/Library/Application\ Support/Jan
rm -rf ~/Library/Application\ Support/Jan-nightly
rm -rf ~/Library/Application\ Support/jan.ai.app
rm -rf ~/Library/Application\ Support/jan-nightly.ai.app
rm -rf ~/Library/Preferences/jan.*
rm -rf ~/Library/Preferences/jan-nightly.*
rm -rf ~/Library/Caches/jan.*
rm -rf ~/Library/Caches/jan-nightly.*
rm -rf ~/Library/Caches/jan.ai.app
rm -rf ~/Library/Caches/jan-nightly.ai.app
rm -rf ~/Library/WebKit/jan.ai.app
rm -rf ~/Library/WebKit/jan-nightly.ai.app
rm -rf ~/Library/Saved\ Application\ State/jan.ai.app
rm -rf ~/Library/Saved\ Application\ State/jan-nightly.ai.app

# Clean up downloaded installer
rm -f "/tmp/jan-installer.dmg"
rm -rf "/tmp/jan-mount"

echo "Cleanup completed"
