#!/bin/bash
# Setup script permissions for AutoQA scripts

echo "Setting up permissions for AutoQA scripts..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Make all shell scripts executable
chmod +x "$SCRIPT_DIR"/*.sh

echo "✅ All shell scripts are now executable:"
ls -la "$SCRIPT_DIR"/*.sh

echo "✅ Permission setup completed"
