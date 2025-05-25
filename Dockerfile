FROM node:22-slim
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY ./package.json ./pnpm-lock.yaml ./
RUN ["pnpm", "install", "--frozen-lockfile"]
COPY . .
CMD ["pnpm", "start"]