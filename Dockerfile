# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy the rest of the source code
COPY . .

EXPOSE 4000

# Run as non-root user for security
USER node

CMD ["node", "index.js"]
