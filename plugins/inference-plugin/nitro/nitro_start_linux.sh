#!/bin/bash

#!/bin/bash

# Attempt to run the nitro_linux_amd64_cuda file and if it fails, run nitro_linux_amd64
./nitro_linux_amd64_cuda "$@" || (echo "nitro_linux_amd64_cuda encountered an error, attempting to run nitro_linux_amd64..." && ./nitro_linux_amd64 "$@")
