FROM node:18-alpine as base

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Expose API port
EXPOSE 3005

# Development stage
FROM base as development
ENV NODE_ENV=development
CMD ["npm", "start"]

# Production stage
FROM base as production
ENV NODE_ENV=production
RUN npm ci --only=production
CMD ["npm", "start"]

