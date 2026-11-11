# Stage 1: build the frontend using Node.js 24 on a minimal Debian Bookworm image.
# Naming this stage "build" lets the final stage copy its generated files.
FROM node:24-bookworm-slim AS build
# Use /app as the working directory for subsequent RUN and COPY instructions.
WORKDIR /app
# Copy dependency manifests first so Docker can reuse the dependency layer
# when application code changes but the manifests stay the same.
COPY package.json package-lock.json ./
# Install the locked dependencies, including development tools needed by Vite.
RUN npm ci
# Copy the frontend build configuration and source code.
COPY vite.config.js ./
COPY web ./web
# Build the frontend assets into /app/dist.
RUN npm run build

# Stage 2: start a fresh image for running the app, leaving build tools behind.
FROM node:24-bookworm-slim
WORKDIR /app
# Set defaults for production mode and the port the server listens on.
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
# Install only runtime dependencies and remove npm's download cache to save space.
RUN npm ci --omit=dev && npm cache clean --force
# Include the backend code and SQL migrations used at startup.
COPY src ./src
COPY migrations ./migrations
# Bring in the compiled frontend from the build stage for the backend to serve.
COPY --from=build /app/dist ./dist
# Run the server as the image's non-root "node" user.
USER node
# Document the container's listening port; publishing it requires Compose ports or -p.
EXPOSE 3000
# Check readiness every 10 seconds, allowing 4 seconds per check. Failures during
# the initial 20-second startup period do not count toward the six-failure limit.
# A successful HTTP response exits with 0; an HTTP or connection error exits with 1.
HEALTHCHECK --interval=10s --timeout=4s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Default startup command. Exec form runs Node directly so it receives stop signals.
CMD ["node", "src/server.js"]
