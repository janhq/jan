#!/bin/bash
# Ubuntu cleanup script for Jan app

echo "Cleaning existing Jan installations..."

# Remove Jan data folders (both regular and nightly)
rm -rf ~/.config/Jan
rm -rf ~/.config/Jan-nightly
rm -rf ~/.local/share/Jan
rm -rf ~/.local/share/Jan-nightly
rm -rf ~/.cache/jan
rm -rf ~/.cache/jan-nightly
rm -rf ~/.local/share/jan-nightly.ai.app
rm -rf ~/.local/share/jan.ai.app

# Kill any running Jan processes (both regular and nightly)
pkill -f "Jan" || true
pkill -f "jan" || true
pkill -f "Jan-nightly" || true
pkill -f "jan-nightly" || true

echo "Jan cleanup completed"
