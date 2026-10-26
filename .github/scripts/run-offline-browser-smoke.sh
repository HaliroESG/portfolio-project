#!/usr/bin/env bash
# Run only inside the new Linux network namespace created by the offline job.
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo "Linux network isolation required"; exit 1; }
# A new namespace has only loopback. Refuse a normal host/container network.
interfaces=$(ip -o link show | awk -F': ' '{print $2}')
[[ "$interfaces" == lo ]] || { echo "Offline runner requires loopback only"; exit 1; }
ip link set lo up
[[ "${NEXT_PUBLIC_SUPABASE_URL:-}" == http://127.0.0.1:54321 ]] || exit 1
[[ "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" == ci-placeholder-anon-key ]] || exit 1
cd "$(dirname "$0")/../../frontend"
for file in .env .env.local .env.production .env.production.local; do
  [[ ! -e "$file" ]] || { echo "Offline runner rejects runtime environment files"; exit 1; }
done
[[ -f .next/BUILD_ID ]] || { echo "Production build required"; exit 1; }
log_dir=$(mktemp -d)
server_pid=''
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$result" != 0 ]]; then tail -n 40 "$log_dir/server.log"; fi
  rm -rf "$log_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001 > "$log_dir/server.log" 2>&1 &
server_pid=$!
ready=false
for ((attempt=0; attempt<45; attempt++)); do
  kill -0 "$server_pid" 2>/dev/null || { echo "Local server exited"; exit 1; }
  if curl --noproxy '*' -fsS http://127.0.0.1:3001 >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo "Local server did not become ready"; exit 1; }
# Same nine routes and desktop/mobile assertions as the manual real smoke.
BASE_URL=http://127.0.0.1:3001 node scripts/browser-smoke.mjs
