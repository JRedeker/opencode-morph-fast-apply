#!/bin/bash
# Runs INSIDE the bwrap sandbox built by run.sh; all paths are sandbox paths.
# Starts the loopback fake servers, then drives the 2.3.2 host with one
# non-interactive `opencode run`. Everything the checks need is written under
# /home/probe (the lab home directory).
set -uo pipefail
export HOME=/home/probe

rm -f /home/probe/records/provider.ready /home/probe/records/morph.ready
rm -f /home/probe/records/provider.jsonl /home/probe/records/morph.jsonl

# bwrap --unshare-net provides an already-UP loopback interface; the sandbox
# process has no capabilities, so "ip link set lo up" is neither possible nor
# needed.

bun /home/probe/probe/fake-servers.ts /home/probe/records &
SERVERS_PID=$!

# Wait for both loopback listeners.
ready=0
for _ in $(seq 1 100); do
  if [[ -f /home/probe/records/provider.ready && -f /home/probe/records/morph.ready ]]; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ $ready -ne 1 ]]; then
  echo "fake servers did not become ready" >&2
  kill "$SERVERS_PID" 2>/dev/null
  wait "$SERVERS_PID" 2>/dev/null
  exit 1
fi

cd /home/probe/session
/home/probe/host/opencode.exe run --standalone --auto --print-logs --log-level debug \
  "Use morph_edit to apply the greeting edit to target.ts, then use morph_edit on ../outside.txt, then finish." \
  > /home/probe/run.stdout.txt 2> /home/probe/run.stderr.txt
RUN_STATUS=$?

kill "$SERVERS_PID" 2>/dev/null
wait "$SERVERS_PID" 2>/dev/null
exit "$RUN_STATUS"
