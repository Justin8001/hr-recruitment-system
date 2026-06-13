# Backend container for Render (Docker runtime)
FROM node:20-slim

WORKDIR /app

# Install dependencies (including devDependencies — tsc/tsx are needed to build)
COPY package*.json ./
RUN npm ci --include=dev

# Copy source and build TypeScript -> dist/
COPY . .
RUN npm run build

# Render injects PORT at runtime; the app reads process.env.PORT
EXPOSE 3001

CMD ["npm", "start"]
