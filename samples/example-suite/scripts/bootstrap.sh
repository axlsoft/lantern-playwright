#!/usr/bin/env bash
# Bootstrap an org, team, project, and API key in the running collector and
# write the resulting credentials to ./.env so the Playwright suite and
# sample-api can pick them up.
set -euo pipefail

COLLECTOR_URL="${COLLECTOR_URL:-http://localhost:8080}"
MAILHOG_URL="${MAILHOG_URL:-http://localhost:8025}"
ENV_FILE="$(dirname "$0")/../.env"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

EMAIL="owner@example.com"
PASSWORD="example-suite-pw-12345"

# ── 1. Wait for collector ──────────────────────────────────────────────────────
echo "→ Waiting for collector at ${COLLECTOR_URL}/healthz ..."
for _ in $(seq 1 60); do
  if curl -sf "${COLLECTOR_URL}/healthz" >/dev/null 2>&1; then break; fi
  sleep 1
done

# ── 2. Sign up ─────────────────────────────────────────────────────────────────
echo "→ Registering owner account ..."
SIGNUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${COLLECTOR_URL}/api/v1/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

if [ "${SIGNUP_STATUS}" != "201" ] && [ "${SIGNUP_STATUS}" != "409" ]; then
  echo "  signup returned unexpected status ${SIGNUP_STATUS}" >&2
  exit 1
fi

# ── 3. Verify email via mailhog ────────────────────────────────────────────────
if [ "${SIGNUP_STATUS}" = "201" ]; then
  echo "→ Waiting for verification email in mailhog ..."
  VERIFY_TOKEN=""
  for _ in $(seq 1 30); do
    MESSAGES=$(curl -sf "${MAILHOG_URL}/api/v2/messages" 2>/dev/null || echo '{"items":[]}')
    VERIFY_TOKEN=$(echo "${MESSAGES}" \
      | jq -r '.items[].Content.Body' 2>/dev/null \
      | grep -o 'token=[0-9a-f-]*' | head -1 | sed 's/token=//')
    if [ -n "${VERIFY_TOKEN:-}" ]; then break; fi
    sleep 1
  done

  if [ -z "${VERIFY_TOKEN:-}" ]; then
    echo "  timed out waiting for verification email" >&2
    exit 1
  fi

  echo "→ Verifying email ..."
  curl -sf "${COLLECTOR_URL}/api/v1/auth/verify?token=${VERIFY_TOKEN}" >/dev/null
fi

# ── 4. Login ────────────────────────────────────────────────────────────────────
echo "→ Logging in ..."
LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${COLLECTOR_URL}/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  -c "${COOKIE_JAR}")

if [ "${LOGIN_STATUS}" != "200" ]; then
  echo "  login failed (HTTP ${LOGIN_STATUS})" >&2
  exit 1
fi

# ── 5. Get org ID ───────────────────────────────────────────────────────────────
echo "→ Fetching user info ..."
ME=$(curl -sS "${COLLECTOR_URL}/api/v1/auth/me" -b "${COOKIE_JAR}")
ORG_ID=$(echo "${ME}" | jq -r '.data.organizations[0].id')

if [ -z "${ORG_ID}" ] || [ "${ORG_ID}" = "null" ]; then
  echo "  could not extract org ID; response: ${ME}" >&2
  exit 1
fi

# ── 6. Create team ──────────────────────────────────────────────────────────────
echo "→ Creating team ..."
TEAM=$(curl -sS -X POST "${COLLECTOR_URL}/api/v1/organizations/${ORG_ID}/teams" \
  -H 'content-type: application/json' \
  -b "${COOKIE_JAR}" \
  -d '{"name":"default"}')
TEAM_ID=$(echo "${TEAM}" | jq -r '.data.id')

if [ -z "${TEAM_ID}" ] || [ "${TEAM_ID}" = "null" ]; then
  echo "  could not extract team ID; response: ${TEAM}" >&2
  exit 1
fi

# ── 7. Create project ───────────────────────────────────────────────────────────
echo "→ Creating project ..."
PROJECT=$(curl -sS -X POST "${COLLECTOR_URL}/api/v1/teams/${TEAM_ID}/projects" \
  -H 'content-type: application/json' \
  -b "${COOKIE_JAR}" \
  -d '{"name":"example-suite","slug":"example-suite"}')
PROJECT_ID=$(echo "${PROJECT}" | jq -r '.data.id')

if [ -z "${PROJECT_ID}" ] || [ "${PROJECT_ID}" = "null" ]; then
  echo "  could not extract project ID; response: ${PROJECT}" >&2
  exit 1
fi

# ── 8. Create API key ───────────────────────────────────────────────────────────
echo "→ Creating API key ..."
KEY=$(curl -sS -X POST "${COLLECTOR_URL}/api/v1/projects/${PROJECT_ID}/api-keys" \
  -H 'content-type: application/json' \
  -b "${COOKIE_JAR}" \
  -d '{"name":"playwright-ci"}')
API_KEY=$(echo "${KEY}" | jq -r '.data.key')

if [ -z "${API_KEY}" ] || [ "${API_KEY}" = "null" ]; then
  echo "  could not extract API key; response: ${KEY}" >&2
  exit 1
fi

# ── 9. Write .env ───────────────────────────────────────────────────────────────
cat > "${ENV_FILE}" <<EOF
LANTERN_COLLECTOR_ENDPOINT=${COLLECTOR_URL}
LANTERN_PROJECT_ID=${PROJECT_ID}
LANTERN_API_KEY=${API_KEY}
SAMPLE_API_URL=http://localhost:5080
EOF

echo "→ Wrote credentials to ${ENV_FILE}"
echo "   org_id=${ORG_ID}"
echo "   team_id=${TEAM_ID}"
echo "   project_id=${PROJECT_ID}"
