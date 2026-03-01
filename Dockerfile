# hush 🛡️ - Docker Gateway
FROM node:18-slim

WORKDIR /app

# Install dependencies first for layer caching
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Default environment
ENV PORT=4000
ENV HUSH_HOST=0.0.0.0
# Note: Bind to 0.0.0.0 inside container so Docker can forward it,
# but host binding remains safe.

EXPOSE 4000

# Start the gateway
CMD ["node", "dist/cli.js"]
