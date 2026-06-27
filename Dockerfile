# Production image for the App Ratings Analyzer.
# Storage is external (Supabase Postgres) so the container is stateless.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies from the lockfile first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

# The server listens on $PORT (default 3000); platforms set PORT automatically.
EXPOSE 3000

CMD ["node", "server.js"]
