#!/bin/bash

set -e

FLAGS=""

# Checking for absolute path in WAYLAND_DISPLAY variable.
# As referenced in the description of the `wl_display_add_socket` function at https://wayland.freedesktop.org/docs/html/apc.html#id-1.11.2
if [ "${WAYLAND_DISPLAY:0:1}" = "/" ]; then
    WAYLAND_SOCKET_PATH="${WAYLAND_DISPLAY}"
else
    WAYLAND_SOCKET_PATH="$XDG_RUNTIME_DIR/${WAYLAND_DISPLAY:-wayland-0}"
fi

if [[ $XDG_SESSION_TYPE == "wayland" && -e "$WAYLAND_SOCKET_PATH" ]]
then
    FLAGS="$FLAGS --ozone-platform-hint=wayland"
    if  [ -c /dev/nvidia0 ]
    then
        FLAGS="$FLAGS --disable-gpu-sandbox"
    fi
fi
export CI=e2e

zypak-wrapper /app/bin/Jan/jan "${FLAGS}" "$@"
