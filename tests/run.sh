#!/usr/bin/env bash
# Roda os testes de provisão sem precisar de um framework de teste.
# Técnica: bundla cada .ts com esbuild (CJS) e roda com NODE_PATH apontando para
# um node_modules de Strapi (para resolver @strapi/utils, do qual o manifest depende).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MANIFEST="$ROOT/docs/strapi.manifest.example.json"
export NODE_ENV=development

# acha um node_modules de Strapi com @strapi/utils
NODE_PATH=""
for d in \
  "$HOME/Desktop/plugin_lunchpad/strapi/node_modules" \
  "$HOME/Desktop/my-tickets/meutest/meutest/node_modules" \
  "$ROOT/plugin/node_modules"; do
  if [ -d "$d/@strapi/utils" ]; then NODE_PATH="$d"; break; fi
done
if [ -z "$NODE_PATH" ]; then
  echo "ERRO: nenhum node_modules com @strapi/utils encontrado." >&2
  exit 1
fi
export NODE_PATH
echo "usando NODE_PATH=$NODE_PATH"

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

fail=0
for t in link orchestrate i18n; do
  npx esbuild "$ROOT/tests/$t.test.ts" --bundle --platform=node --format=cjs \
    --packages=external --log-level=error --outfile="$BUILD/$t.js"
  node "$BUILD/$t.js" || fail=1
done

exit $fail
