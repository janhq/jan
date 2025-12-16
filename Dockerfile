# Stage 1: Build stage with Node.js and Yarn v4
FROM node:20-alpine AS builder

ARG JAN_BASE_URL=https://api-dev.jan.ai/v1
ENV JAN_BASE_URL=$JAN_BASE_URL

ARG ENVIRONMENT=dev
ENV ENVIRONMENT=$ENVIRONMENT

ARG VITE_AUTH_URL=https://auth.jan.ai
ENV VITE_AUTH_URL=$VITE_AUTH_URL

ARG VITE_AUTH_REALM=jan
ENV VITE_AUTH_REALM=$VITE_AUTH_REALM

ARG VITE_AUTH_CLIENT_ID=jan-client
ENV VITE_AUTH_CLIENT_ID=$VITE_AUTH_CLIENT_ID

ARG VITE_OAUTH_REDIRECT_URI=https://chat.jan.ai/auth/callback
ENV VITE_OAUTH_REDIRECT_URI=$VITE_OAUTH_REDIRECT_URI

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
WORKDIR /appdir

# Copy source code
COPY ./app ./app
COPY ./Makefile ./Makefile
COPY ./.* /
COPY ./package.json ./package.json
COPY ./yarn.lock ./yarn.lock

# Build web application
RUN yarn install && make build-web-app-newui

# Stage 2: Production stage with Nginx
FROM nginx:alpine

# Copy static files from build stage
COPY --from=builder /appdir/app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]