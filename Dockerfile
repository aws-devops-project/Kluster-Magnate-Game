# Use a slim, secure Alpine image
FROM node:20-alpine

# Security: Do not run as root. Alpine already includes a 'node' user.
# We will use that user.

# Set to production environment for optimized performance
ENV NODE_ENV=production
ENV PORT=3001

# Create app directory and set ownership
WORKDIR /usr/src/app
RUN chown node:node /usr/src/app

# Switch to the non-root user
USER node

# Copy package files first to leverage Docker layer caching
COPY --chown=node:node package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy game files and backend server
COPY --chown=node:node . .

# Expose the default port (can be overridden at runtime via -e PORT=80)
EXPOSE 3001

# Start the game server
CMD ["node", "server.js"]
