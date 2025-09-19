# ===== Build Stage =====
FROM node:18-slim AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json yarn.lock* package-lock.json* ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci || yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build || yarn build

# ===== Production Stage =====
FROM node:18-slim AS production

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* ./

# Install only production dependencies
RUN npm ci --only=production || yarn install --production --frozen-lockfile

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/knexfile.js ./

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/data /app/sessions && \
    chown -R node:node /app

# Create a non-root user to run the application
USER node

# Expose the port the app runs on
EXPOSE 3000

# Set the command to run the application
CMD ["node", "dist/index.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: process.env.PORT || 3000, path: '/health', timeout: 2000 }; const req = http.get(options, (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1)); req.end();"
