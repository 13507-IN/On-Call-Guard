FROM node:22-alpine

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/demo-app/package.json apps/demo-app/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY services/api/package.json services/api/package.json
COPY services/monitor/package.json services/monitor/package.json
COPY services/triage/package.json services/triage/package.json
COPY services/executor/package.json services/executor/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY . .

ARG WORKSPACE
ENV WORKSPACE=${WORKSPACE}
ENV NEXT_TELEMETRY_DISABLED=1

RUN if [ "$WORKSPACE" = "apps/dashboard" ]; then npm run build --workspace="$WORKSPACE"; fi

ENV NODE_ENV=production

CMD ["sh", "-c", "npm run start --workspace \"$WORKSPACE\""]
