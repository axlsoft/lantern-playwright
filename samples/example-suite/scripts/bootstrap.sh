#!/usr/bin/env bash
# Bootstrap an org, project, and API key in the running collector and write
# the resulting credentials to ./.env so the Playwright suite + sample-api can
# pick them up.
set -euo pipefail

COLLECTOR_URL="${COLLECTOR_URL:-http://localhost:8080}"
ENV_FILE="$(dirname "$0")/../.env"

echo "→ Waiting for collector at ${COLLECTOR_URL}/healthz ..."
for _ in $(seq 1 60); do
  if curl -sf "${COLLECTOR_URL}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "→ Registering owner account ..."
SIGNUP=$(curl -sS -X POST "${COLLECTOR_URL}/v1/auth/signup" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"example-suite-pw-12345","org_name":"Example Org"}')
SESSION_TOKEN=$(echo "${SIGNUP}" | sed -n 's/.*"session_token":"\([^"]*\)".*/\1/p')

if [ -z "${SESSION_TOKEN}" ]; then
  echo "  signup may already exist, attempting login ..."
  LOGIN=$(curl -sS -X POST "${COLLECTOR_URL}/v1/auth/login" \
    -H 'content-type: application/json' \
    -d '{"email":"owner@example.com","password":"example-suite-pw-12345"}')
  SESSION_TOKEN=$(echo "${LOGIN}" | sed -n 's/.*"session_token":"\([^"]*\)".*/\1/p')
fi

if [ -z "${SESSION_TOKEN}" ]; then
  echo "  could not authenticate; aborting" >&2
  exit 1
fi

echo "→ Creating project ..."
PROJECT=$(curl -sS -X POST "${COLLECTOR_URL}/v1/projects" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${SESSION_TOKEN}" \
  -d '{"name":"example-suite","slug":"example-suite"}')
PROJECT_ID=$(echo "${PROJECT}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

echo "→ Creating API key ..."
KEY=$(curl -sS -X POST "${COLLECTOR_URL}/v1/projects/${PROJECT_ID}/api-keys" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${SESSION_TOKEN}" \
  -d '{"name":"playwright-ci"}')
API_KEY=$(echo "${KEY}" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')

cat > "${ENV_FILE}" <<EOF
LANTERN_COLLECTOR_ENDPOINT=${COLLECTOR_URL}
LANTERN_PROJECT_ID=${PROJECT_ID}
LANTERN_API_KEY=${API_KEY}
SAMPLE_API_URL=http://localhost:5080
EOF

echo "→ Wrote credentials to ${ENV_FILE}"
echo "   project_id=${PROJECT_ID}"
