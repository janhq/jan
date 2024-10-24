#!/bin/bash
DATA_FOLDER_NAME=jan

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'jan' '/usr/bin/jan'
else
    rm -f '/usr/bin/jan'
fi

# Check if the script is running during an upgrade
if [ "$1" = "upgrade" ] || [ "$1" = "1" ]; then
  echo "The application is being upgraded. Skipping script execution."
  exit 0
fi

echo "The application is being removed. Executing afterRemove script."

# Determine the home directory based on the user
USER_TO_RUN_AS=${SUDO_USER:-$(whoami)}
if [ "$USER_TO_RUN_AS" = "root" ]; then
    USER_HOME="/root"
else
    USER_HOME="/home/$USER_TO_RUN_AS"
fi

# Check if the folder exists before asking the user
if [ -d "$USER_HOME/$DATA_FOLDER_NAME" ]; then
    echo "Do you want to delete the ~/$DATA_FOLDER_NAME data folder? (yes/no) [default: no]"
    read -r answer

    while true; do
        case "$answer" in
            [yY][eE][sS]|[yY])
                echo "Deleting jan data folders..."
                if [ -d "$USER_HOME/$DATA_FOLDER_NAME" ]; then
                    echo "Removing $USER_HOME/$DATA_FOLDER_NAME"
                    rm -rf "$USER_HOME/$DATA_FOLDER_NAME" > /dev/null 2>&1
                fi
                break
                ;;
            [nN][oO]|[nN]|"")
                echo "Keeping the 'jan' data folders."
                break
                ;;
            *)
                echo "Invalid response. Please type 'yes', 'no', 'y', or 'n' (case-insensitive)."
                read -r answer
                ;;
        esac
    done
else
    # If the folder doesn't exist, exit without printing anything
    exit 0
fi

exit 0
