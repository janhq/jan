#!/bin/bash
# Common test runner script

JAN_APP_PATH="$1"
PROCESS_NAME="$2"
RP_TOKEN="$3"
PLATFORM="$4"

echo "Starting Auto QA Tests..."
echo "Platform: $PLATFORM"
echo "Jan app path: $JAN_APP_PATH"
echo "Process name: $PROCESS_NAME"

# Platform-specific setup
if [ "$PLATFORM" = "ubuntu" ]; then
    # Get the current display session
    export DISPLAY=$(w -h | awk 'NR==1 {print $2}')
    echo "Display ID: $DISPLAY"

    # Verify display is working
    if [ -z "$DISPLAY" ]; then
        echo "No display session found, falling back to :0"
        export DISPLAY=:0
    fi

    echo "Using display: $DISPLAY"

    # Test display connection
    xdpyinfo -display $DISPLAY >/dev/null 2>&1 || {
        echo "Display $DISPLAY is not available"
        exit 1
    }

    # Make Jan executable if needed
    if [ -f "/usr/bin/Jan-nightly" ]; then
        sudo chmod +x /usr/bin/Jan-nightly
    fi
    if [ -f "/usr/bin/Jan" ]; then
        sudo chmod +x /usr/bin/Jan
    fi
fi

# macOS specific setup
if [ "$PLATFORM" = "macos" ]; then
    # Verify Jan app path
    if [ ! -f "$JAN_APP_PATH" ]; then
        echo "❌ Jan app not found at: $JAN_APP_PATH"
        echo "Available files in /Applications:"
        ls -la /Applications/ | grep -i jan || echo "No Jan apps found"
        exit 1
    fi
fi

# Change to autoqa directory to ensure correct working directory
cd "$(dirname "$0")/.."
echo "Current working directory: $(pwd)"
echo "Contents of current directory:"
ls -la
echo "Contents of trajectories directory (if exists):"
ls -la trajectories/ 2>/dev/null || echo "trajectories directory not found"

# Run the main test with proper arguments
if [ -n "$JAN_APP_PATH" ] && [ -n "$PROCESS_NAME" ]; then
    python main.py --enable-reportportal --rp-token "$RP_TOKEN" --jan-app-path "$JAN_APP_PATH" --jan-process-name "$PROCESS_NAME"
elif [ -n "$JAN_APP_PATH" ]; then
    python main.py --enable-reportportal --rp-token "$RP_TOKEN" --jan-app-path "$JAN_APP_PATH"
else
    python main.py --enable-reportportal --rp-token "$RP_TOKEN"
fi
