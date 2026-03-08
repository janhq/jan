#!/bin/bash

# File path to be modified
FILE_PATH="electron/scripts/uninstaller.nsh"

# Check if the correct number of arguments is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <channel>"
    exit 1
fi

CHANNEL="$1"

# Check if the file exists
if [ ! -f "$FILE_PATH" ]; then
    echo "File does not exist: $FILE_PATH"
    exit 1
fi

# Perform the replacements
sed -i -e "s#Jan#Jan-$CHANNEL#g" "$FILE_PATH"
sed -i -e "s#jan#jan-$CHANNEL#g" "$FILE_PATH"

# Notify completion
echo "File has been updated: $FILE_PATH"