FROM node:22-alpine

WORKDIR /app

# Install dependencies (includes vite/esbuild now in dependencies)
COPY package*.json ./
RUN NODE_ENV=development npm ci

# Copy source and build
COPY . .
# VITE_WAITLIST_MODE est injecté par Railway comme build-arg
ARG VITE_WAITLIST_MODE=false
ENV VITE_WAITLIST_MODE=$VITE_WAITLIST_MODE
RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start"]
