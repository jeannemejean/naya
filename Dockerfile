FROM node:22-alpine

WORKDIR /app

# Install dependencies (includes vite/esbuild now in dependencies)
# npm install (et non npm ci) : résout les paquets optionnels propres à la plateforme
# Linux du builder (évite l'échec "Missing @esbuild/linux-*" dû aux divergences de
# résolution entre le npm local et celui du builder).
COPY package*.json ./
RUN NODE_ENV=development npm install --no-audit --no-fund

# Copy source and build
COPY . .
# VITE_WAITLIST_MODE est injecté par Railway comme build-arg
ARG VITE_WAITLIST_MODE=false
ENV VITE_WAITLIST_MODE=$VITE_WAITLIST_MODE
RUN npm run build

EXPOSE 8080

CMD ["npm", "run", "start"]
