FROM node:22-alpine

WORKDIR /app

# Install dependencies (includes vite/esbuild now in dependencies)
COPY package*.json ./
RUN NODE_ENV=development npm ci

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start"]
