#!/usr/bin/env bash
# Runs the same checks as GitHub Actions. Use before every push: ./scripts/check.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "→ Terraform formatting"
terraform fmt -check -recursive infra/ || { echo "✗ Run: terraform fmt -recursive infra/"; exit 1; }

echo "→ API: clean install from the committed lock file, then tests"
(cd app/api && npm ci --silent && npm test)

echo "→ Frontend: clean install, tests, production build"
(cd app/frontend && npm ci --silent && npm test && npm run build)

echo "→ What's staged for commit"
git diff --cached --name-only

if git status --short | grep -q '^??'; then
  echo "⚠ Files that exist only on this laptop (not committed):"
  git status --short | grep '^??'
fi

echo "✅ All checks passed"