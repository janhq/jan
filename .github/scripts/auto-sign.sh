#!/bin/bash

# Check if both APP_PATH and DEVELOPER_ID environment variables are set
if [[ -z "$APP_PATH" ]] || [[ -z "$DEVELOPER_ID" ]]; then
    echo "Either APP_PATH or DEVELOPER_ID is not set. Skipping script execution."
    exit 0
fi

# If both variables are set, execute the following commands
find "$APP_PATH" \( -type f -perm +111 -o -name "*.node" \) -exec codesign --force -s "$DEVELOPER_ID" --options=runtime {} \;

find "$APP_PATH" -type f -name "*.o" -exec codesign --force -s "$DEVELOPER_ID" --options=runtime {} \;
