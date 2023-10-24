#!/bin/bash

APP_PATH=${APP_PATH}
DEVELOPER_ID=${DEVELOPER_ID}
find $APP_PATH -type f -perm +111 -exec codesign -s "$DEVELOPER_ID" --options=runtime {} \;