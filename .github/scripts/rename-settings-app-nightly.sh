#!/bin/bash

# File path to be modified
FILE_PATH="$1"

# Check if the file exists
if [ ! -f "$FILE_PATH" ]; then
    echo "File does not exist: $FILE_PATH"
    exit 1
fi

# Perform the replacements
sed -i -e "s|const configurationFileName = 'settings.json'|const configurationFileName = 'settings-beta.json'|g" "$FILE_PATH"
sed -i -e "s#const defaultJanDataFolder = join(os?.homedir() || '', 'jan')#const defaultJanDataFolder = join(os?.homedir() || '', 'jan-beta')#g" "$FILE_PATH"

# Notify completion
echo "File has been updated: $FILE_PATH"
