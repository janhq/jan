#!/bin/bash

APP_PATH=${APP_PATH}
DEVELOPER_ID=${DEVELOPER_ID}
find $APP_PATH \( -type f -perm +111 -o -name "*.node" \) -exec codesign -s "$DEVELOPER_ID" --options=runtime {} \;