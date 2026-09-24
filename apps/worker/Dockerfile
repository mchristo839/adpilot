FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY templates ./templates
RUN pnpm install --frozen-lockfile --filter @adpilot/worker... --prod=false
ENV NODE_ENV=production PORT=8787 TEMPLATES_DIR=/app/templates
EXPOSE 8787
CMD ["pnpm", "--filter", "@adpilot/worker", "start"]
