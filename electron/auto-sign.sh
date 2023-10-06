#!/bin/bash

DEVELOPER_ID="Developer ID Application: Eigenvector Pte Ltd"

find electron -type f -perm +111 -exec codesign -s "Developer ID Application: Eigenvector Pte Ltd (YT49P7GXG4)" --options=runtime {} \;