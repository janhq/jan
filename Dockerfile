FROM node:20-bookworm AS base

# 1. Install dependencies only when needed
FROM base AS builder

# Install g++ 11
RUN apt update && apt install -y gcc-11 g++-11 cpp-11 jq xsel && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY . ./

RUN export NITRO_VERSION=$(cat extensions/inference-nitro-extension/bin/version.txt) && \
    jq --arg nitroVersion $NITRO_VERSION '(.scripts."downloadnitro:linux" | gsub("\\${NITRO_VERSION}"; $nitroVersion)) | gsub("\r"; "")' extensions/inference-nitro-extension/package.json > /tmp/newcommand.txt && export NEW_COMMAND=$(sed 's/^"//;s/"$//' /tmp/newcommand.txt) && jq --arg newCommand "$NEW_COMMAND" '.scripts."downloadnitro:linux" = $newCommand' extensions/inference-nitro-extension/package.json > /tmp/package.json && mv /tmp/package.json extensions/inference-nitro-extension/package.json
RUN make install-and-build

# # 2. Rebuild the source code only when needed
FROM base AS runner

# Install g++ 11
RUN apt update && apt install -y gcc-11 g++-11 cpp-11 jq xsel && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the package.json and yarn.lock of root yarn space to leverage Docker cache
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/yarn.lock ./yarn.lock

# Copy the package.json, yarn.lock, and build output of server yarn space to leverage Docker cache
COPY --from=builder /app/core ./core/
COPY --from=builder /app/server ./server/
RUN cd core && yarn install && yarn run build
RUN yarn workspace @janhq/server install && yarn workspace @janhq/server build
COPY --from=builder /app/docs/openapi ./docs/openapi/

# Copy pre-install dependencies
COPY --from=builder /app/pre-install ./pre-install/

# Copy the package.json, yarn.lock, and output of web yarn space to leverage Docker cache
COPY --from=builder /app/uikit ./uikit/
COPY --from=builder /app/web ./web/
COPY --from=builder /app/models ./models/

RUN yarn workspace @janhq/uikit install && yarn workspace @janhq/uikit build
RUN yarn workspace jan-web install

RUN npm install -g serve@latest

EXPOSE 1337 3000 3928

ENV JAN_API_HOST 0.0.0.0
ENV JAN_API_PORT 1337

ENV API_BASE_URL http://localhost:1337

CMD ["sh", "-c", "export NODE_ENV=production && yarn workspace jan-web build && cd web && npx serve out & cd server && node build/main.js"]

# docker build -t jan .
# docker run -p 1337:1337 -p 3000:3000 -p 3928:3928 jan
