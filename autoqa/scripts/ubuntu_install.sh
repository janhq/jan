#!/bin/bash
# Ubuntu install script for Jan app

IS_NIGHTLY="$1"

INSTALLER_PATH="/tmp/jan-installer.deb"

echo "Installing Jan app..."
echo "Is nightly build: $IS_NIGHTLY"

# Install the .deb package
sudo apt install "$INSTALLER_PATH" -y
sudo apt-get install -f -y

# Wait for installation to complete
sleep 10

echo "[INFO] Waiting for Jan app first initialization (120 seconds)..."
echo "This allows Jan to complete its initial setup and configuration"
sleep 120
echo "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if [ "$IS_NIGHTLY" = "true" ]; then
    DEFAULT_JAN_PATH="/usr/bin/Jan-nightly"
    PROCESS_NAME="Jan-nightly"
else
    DEFAULT_JAN_PATH="/usr/bin/Jan"
    PROCESS_NAME="Jan"
fi

if [ -f "$DEFAULT_JAN_PATH" ]; then
    echo "Jan app installed successfully at: $DEFAULT_JAN_PATH"
    echo "JAN_APP_PATH=$DEFAULT_JAN_PATH" >> $GITHUB_ENV
    echo "JAN_PROCESS_NAME=$PROCESS_NAME" >> $GITHUB_ENV
else
    echo "Jan app not found at expected location: $DEFAULT_JAN_PATH"
    echo "Will auto-detect during test run"
fi
