# Stage 1: Build stage with Node.js and Yarn v4
FROM node:20-alpine AS builder

ARG JAN_BASE_URL=https://api-dev.jan.ai/v1
ENV JAN_BASE_URL=$JAN_BASE_URL

# Install build dependencies
RUN apk add --no-cache \
    make \
    g++ \
    python3 \
    py3-pip \
    git

# Enable corepack and install Yarn 4
RUN corepack enable && corepack prepare yarn@4.5.3 --activate

# Verify Yarn version
RUN yarn --version

# Set working directory
WORKDIR /app

# Copy source code
COPY ./web-app ./web-app
COPY ./Makefile ./Makefile
COPY ./.* /
COPY ./package.json ./package.json
COPY ./yarn.lock ./yarn.lock
COPY ./pre-install ./pre-install
COPY ./core ./core

# Build web application
RUN yarn install && yarn build:core && make build-web-app

# Stage 2: Production stage with Nginx
FROM nginx:alpine

# Copy static files from build stage
COPY --from=builder /app/web-app/dist-web /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
