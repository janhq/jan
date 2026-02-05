#!/bin/bash
# Ubuntu post-test cleanup script

IS_NIGHTLY="$1"

echo "Cleaning up after tests..."

# Kill any running Jan processes (both regular and nightly)
pkill -f "Jan" || true
pkill -f "jan" || true
pkill -f "Jan-nightly" || true
pkill -f "jan-nightly" || true

# Remove Jan data folders (both regular and nightly)
rm -rf ~/.config/Jan
rm -rf ~/.config/Jan-nightly
rm -rf ~/.local/share/Jan
rm -rf ~/.local/share/Jan-nightly
rm -rf ~/.cache/jan
rm -rf ~/.cache/jan-nightly
rm -rf ~/.local/share/jan-nightly.ai.app
rm -rf ~/.local/share/jan.ai.app

# Try to uninstall Jan app
if [ "$IS_NIGHTLY" = "true" ]; then
    PACKAGE_NAME="jan-nightly"
else
    PACKAGE_NAME="jan"
fi

echo "Attempting to uninstall package: $PACKAGE_NAME"

if dpkg -l | grep -q "$PACKAGE_NAME"; then
    echo "Found package $PACKAGE_NAME, uninstalling..."
    sudo dpkg -r "$PACKAGE_NAME" || true
    sudo apt-get autoremove -y || true
else
    echo "Package $PACKAGE_NAME not found in dpkg list"
fi

# Clean up downloaded installer
rm -f "/tmp/jan-installer.deb"

echo "Cleanup completed"
