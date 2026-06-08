#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PY="${BACKEND_PY:-$ROOT_DIR/backend/.venv/bin/python}"

if [[ ! -x "$BACKEND_PY" ]]; then
  BACKEND_PY="python3"
fi

echo "== Backend import smoke =="
(
  cd "$ROOT_DIR"
  "$BACKEND_PY" -c "import sys; sys.path.insert(0, 'backend'); import app.main; print('backend import ok')"
)

echo "== Backend tests =="
(
  cd "$ROOT_DIR"
  "$BACKEND_PY" -m pytest backend/tests/smoke_test.py -q
)

echo "== Frontend tests =="
(
  cd "$ROOT_DIR/frontend"
  npm run test -- --run
)

echo "== Frontend build =="
(
  cd "$ROOT_DIR/frontend"
  npm run build
)

if [[ -n "${HEALTH_URL:-}" ]]; then
  echo "== Live health endpoint =="
  curl -fsS "$HEALTH_URL" | "$BACKEND_PY" -m json.tool
else
  echo "== Live health endpoint skipped =="
  echo "Set HEALTH_URL=https://your-api/health to include live health verification."
  if [[ "${REQUIRE_HEALTH_URL:-0}" == "1" ]]; then
    echo "REQUIRE_HEALTH_URL=1 was set, so production check cannot pass without HEALTH_URL." >&2
    exit 1
  fi
fi

echo "Production check complete."
