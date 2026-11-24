#!/usr/bin/env bash
# Qualifying probe for OpenCode 2.4.1.
#
# Proves, against the real 2.4.1 host binary, that a plugin directory:
#   a. loads from a local path through the V2 plural `plugins` config key;
#   b. offers morph_edit to the model as a direct (top-level) tool rather than
#      only inside the Code Mode `execute` tool;
#   c. completes one fast-apply edit through the Morph Apply endpoint;
#   d. refuses an edit whose target lies outside the session root.
#
# The 2.4.1 binary is only ever executed inside bubblewrap with tmpfs over
# every host home directory and /run, --unshare-net, and a --clearenv
# environment. No real credential, config, socket, or network path is
# reachable from inside the sandbox: both the provider endpoint and the Morph
# endpoint are loopback fake servers started inside the sandbox network
# namespace, and the API keys below are dummies.
#
# Usage: run.sh [path-to-opencode-2.4.1-binary] [plugin-directory]
#
#   path    Native opencode 2.4.1 executable (for example
#           node_modules/@opencode/cli-linux-x64/bin/opencode). When omitted,
#           the glibc @opencode/cli-linux-<arch>@2.4.1 package is installed
#           into a temp directory with bun, without running package scripts.
#   plugin  Plugin directory to bind read-only into the sandbox. Defaults to
#           this repository's root; run `bun install` there first.
#
# Prints one PASS/FAIL line per check a-d and exits non-zero on any failure.
# Set OC_PROBE_KEEP=1 to keep the lab directory for debugging.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROVIDER_PORT=8787
MORPH_PORT=8788
OPENCODE_KEY="probe-openai-key"
MORPH_KEY="probe-morph-key"
RUN_TIMEOUT_SECONDS=300

LAB=""
BIN_TMP=""

cleanup() {
  if [[ -n "$LAB" && -z "${OC_PROBE_KEEP:-}" ]]; then rm -rf "$LAB"; fi
  if [[ -n "$BIN_TMP" && -z "${OC_PROBE_KEEP:-}" ]]; then rm -rf "$BIN_TMP"; fi
}
trap cleanup EXIT

die() {
  echo "FAIL: $*" >&2
  exit 1
}

for tool in bwrap jq timeout; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool not found: $tool"
done

BUN="${BUN:-$(command -v bun || true)}"
if [[ -z "$BUN" && -x "$HOME/.bun/bin/bun" ]]; then BUN="$HOME/.bun/bin/bun"; fi
[[ -n "$BUN" ]] || die "bun not found (set BUN=/path/to/bun)"

BIN_ARG="${1:-}"
PLUGIN_DIR="${2:-$REPO_ROOT}"

# --- Resolve the 2.4.1 binary -------------------------------------------------

if [[ -n "$BIN_ARG" ]]; then
  [[ -f "$BIN_ARG" && -x "$BIN_ARG" ]] || die "binary is not an executable file: $BIN_ARG"
  BIN="$BIN_ARG"
else
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) die "no @opencode/cli platform package for $(uname -m); pass a binary path" ;;
  esac
  PLATFORM_PACKAGE="@opencode/cli-linux-$ARCH@2.4.1"
  echo "no binary given; installing $PLATFORM_PACKAGE into a temp dir with bun"
  BIN_TMP="$(mktemp -d)"
  # The own package.json stops bun from adopting a parent project, and
  # --ignore-scripts keeps lifecycle scripts from running the binary on the
  # host.
  printf '{ "private": true }\n' > "$BIN_TMP/package.json"
  (cd "$BIN_TMP" && "$BUN" add --ignore-scripts "$PLATFORM_PACKAGE" >/dev/null) \
    || die "bun add $PLATFORM_PACKAGE failed"
  BIN="$BIN_TMP/node_modules/@opencode/cli-linux-$ARCH/bin/opencode"
  [[ -f "$BIN" && -x "$BIN" ]] || die "installed binary missing: $BIN"
fi

# --- Validate the plugin directory --------------------------------------------

[[ -d "$PLUGIN_DIR" ]] || die "plugin directory not found: $PLUGIN_DIR"
[[ -f "$PLUGIN_DIR/index.ts" ]] || die "plugin directory has no index.ts: $PLUGIN_DIR"
[[ -d "$PLUGIN_DIR/node_modules" ]] || die "plugin directory has no node_modules; run bun install in $PLUGIN_DIR first"

PLUGIN_ABS="$(cd "$PLUGIN_DIR" && pwd)"

# --- Build the sandbox lab ----------------------------------------------------

LAB="$(mktemp -d)"
mkdir -p "$LAB/home/session" "$LAB/home/records" "$LAB/home/.bun/bin"

cat > "$LAB/home/session/opencode.json" <<EOF
{
  "plugins": ["/home/probe/plugin"],
  "model": "openai/probe-model",
  "providers": {
    "openai": {
      "settings": {
        "baseURL": "http://127.0.0.1:$PROVIDER_PORT/v1",
        "apiKey": "$OPENCODE_KEY"
      },
      "models": {
        "probe-model": {
          "name": "Probe Model",
          "capabilities": { "tools": true }
        }
      }
    }
  }
}
EOF

printf 'const greeting = "hello";\n\nfunction ping() {\n  return greeting;\n}\n' > "$LAB/home/session/target.ts"
printf 'do not touch\n' > "$LAB/home/outside.txt"

# Every execution of the 2.4.1 binary and the fake servers happens through
# this array: read-only root, empty tmpfs over every host home directory and
# /run (which holds per-user agent, keyring and bus sockets), the lab home
# bound in their place, no network besides the namespace loopback, and a
# cleared environment with dummy keys only.
HOST_HOME="$(cd "$HOME" && pwd -P)"
HOME_MASKS=(--tmpfs /home)
if [[ "$HOST_HOME" != /home/* ]]; then HOME_MASKS+=(--tmpfs "$HOST_HOME"); fi
BWRAP=(
  bwrap
  --ro-bind / /
  "${HOME_MASKS[@]}"
  --tmpfs /run
  --bind "$LAB/home" /home/probe
  --ro-bind "$PLUGIN_ABS" /home/probe/plugin
  --ro-bind "$SCRIPT_DIR" /home/probe/probe
  --ro-bind "$BIN" /home/probe/host/opencode.exe
  --ro-bind "$BUN" /home/probe/.bun/bin/bun
  --dev /dev --proc /proc --tmpfs /tmp
  --unshare-net --unshare-pid --die-with-parent --clearenv
  --setenv HOME /home/probe
  --setenv PATH "/usr/bin:/bin:/home/probe/.bun/bin"
  --setenv TERM dumb
  --setenv OPENAI_API_KEY "$OPENCODE_KEY"
  --setenv MORPH_API_KEY "$MORPH_KEY"
  --setenv MORPH_API_URL "http://127.0.0.1:$MORPH_PORT"
)

VERSION="$("${BWRAP[@]}" /home/probe/host/opencode.exe --version)" || die "could not run the binary inside bwrap"
echo "host binary: $VERSION ($BIN)"
[[ "$VERSION" == *"v2.4.1" ]] || die "this probe targets opencode v2.4.1, got: $VERSION"
echo "plugin dir:  $PLUGIN_ABS"

echo "running probe session inside bwrap (network namespace loopback only)"
set +e
timeout "$RUN_TIMEOUT_SECONDS" "${BWRAP[@]}" /bin/bash /home/probe/probe/sandbox-inner.sh
RUN_STATUS=$?
set -e
echo "sandbox exit status: $RUN_STATUS"

PROVIDER_JSONL="$LAB/home/records/provider.jsonl"
MORPH_JSONL="$LAB/home/records/morph.jsonl"
TARGET_FILE="$LAB/home/session/target.ts"
OUTSIDE_FILE="$LAB/home/outside.txt"

DIAGNOSED=""
diagnose() {
  if [[ -n "$DIAGNOSED" ]]; then return; fi
  DIAGNOSED=1
  echo "--- diagnostics: $1" >&2
  local stderr_file="$LAB/home/run.stderr.txt"
  if [[ ! -f "$stderr_file" ]]; then return; fi
  if grep -aqE "morph_edit|ERROR|Error" "$stderr_file"; then
    grep -aE "morph_edit|ERROR|Error" "$stderr_file" | tail -c 1500 >&2 || true
  else
    tail -c 800 "$stderr_file" >&2 || true
  fi
}

# any_record <jq-predicate> <jsonl-file>: true when some recorded request
# satisfies the predicate; false when the file is absent.
any_record() {
  [[ -f "$2" ]] && jq -e -s "any(.[]; $1)" "$2" >/dev/null
}

INPUT_ITEMS='(.body.input // [] | if type == "array" then . else [] end)'
DIRECT_TOOL='((.body.tools // []) | any(.name? == "morph_edit"))'

# --- Check a: plugin loads through the V2 `plugins` config key ----------------

# Only host-authored request parts count as registration evidence: the tools
# list, top-level instructions, and system/developer messages (where the Code
# Mode catalog lives). The user prompt and the scripted function calls name
# morph_edit whether or not the plugin loaded.
HOST_MENTIONS='((.body | del(.input) | tojson | contains("morph_edit")) or ([ '"$INPUT_ITEMS"'[] | select(.role? == "system" or .role? == "developer") ] | tojson | contains("morph_edit")))'

A_WHERE="nowhere"
if any_record "$HOST_MENTIONS" "$PROVIDER_JSONL"; then
  if any_record "$DIRECT_TOOL" "$PROVIDER_JSONL"; then
    A_WHERE="registered (direct tool in provider request)"
  else
    A_WHERE="registered (Code Mode catalog only in provider request)"
  fi
fi
if [[ "$A_WHERE" != "nowhere" ]]; then
  echo "PASS a: plugin loaded via plugins key, morph_edit $A_WHERE"
else
  echo "FAIL a: no host-authored provider request part mentions morph_edit; the plugin did not load or register"
  diagnose "no morph_edit in provider requests"
fi

# --- Check b: morph_edit is a direct (top-level) tool --------------------------

B_OK=false
if any_record "$DIRECT_TOOL" "$PROVIDER_JSONL"; then
  B_OK=true
fi
if [[ "$B_OK" == true ]]; then
  echo "PASS b: morph_edit is a top-level tool in the provider request"
else
  echo "FAIL b: morph_edit is not a top-level tool in any provider request"
fi

# --- Check c: one successful fast-apply edit ----------------------------------

EXPECTED_TARGET='const greeting = "hello world";

function ping() {
  return greeting;
}'

C_MORPH=false
# The Morph request is recorded as raw wire text (JSON-escaped quotes), so
# match on quote-free fragments: the original file body, the update, and the
# default model name.
if any_record '((.body | if type == "string" then . else tojson end) | contains("function ping") and contains("hello world") and contains("morph-v3-fast"))' "$MORPH_JSONL"; then
  C_MORPH=true
fi

C_RESULT=false
if any_record "$INPUT_ITEMS"' | any((.type? == "function_call_output") and ((.output | tojson) | contains("Applied edit to target.ts")))' "$PROVIDER_JSONL"; then
  C_RESULT=true
fi

C_FILE=false
if [[ -f "$TARGET_FILE" ]] && printf '%s\n' "$EXPECTED_TARGET" | diff -q - "$TARGET_FILE" >/dev/null 2>&1; then
  C_FILE=true
fi

if [[ "$C_MORPH" == true && "$C_RESULT" == true && "$C_FILE" == true ]]; then
  echo "PASS c: morph_edit called the Morph endpoint and target.ts holds the expected merge"
else
  echo "FAIL c: fast-apply edit incomplete (morph request: $C_MORPH, tool success result: $C_RESULT, file merged: $C_FILE)"
  diagnose "check c evidence"
fi

# --- Check d: refused edit outside the session root ----------------------------

D_RESULT=false
if any_record "$INPUT_ITEMS"' | any((.type? == "function_call_output") and ((.output | tojson) | contains("outside allowed root") and contains("No file was modified")))' "$PROVIDER_JSONL"; then
  D_RESULT=true
fi

D_FILE=false
if [[ -f "$OUTSIDE_FILE" ]] && printf 'do not touch\n' | diff -q - "$OUTSIDE_FILE" >/dev/null 2>&1; then
  D_FILE=true
fi

# An absent morph.jsonl means the Morph endpoint saw no request at all.
D_NO_MORPH=true
if any_record '((.body | if type == "string" then . else tojson end) | contains("outside.txt"))' "$MORPH_JSONL"; then
  D_NO_MORPH=false
fi

if [[ "$D_RESULT" == true && "$D_FILE" == true && "$D_NO_MORPH" == true ]]; then
  echo "PASS d: outside-root morph_edit refused, outside.txt unchanged, Morph endpoint never saw it"
else
  echo "FAIL d: refusal evidence incomplete (refusal result: $D_RESULT, outside.txt unchanged: $D_FILE, outside target absent from Morph requests: $D_NO_MORPH)"
  diagnose "check d evidence"
fi

# --- Observed facts ------------------------------------------------------------

if [[ -f "$PROVIDER_JSONL" ]]; then
  PATHS_SEEN="$(jq -sr '[.[].path] | unique | join(" ")' "$PROVIDER_JSONL" 2>/dev/null || echo "?")"
  echo "observed provider endpoints: $PATHS_SEEN"
fi

FAILURES=0
if [[ "$A_WHERE" == "nowhere" ]]; then FAILURES=$((FAILURES + 1)); fi
[[ "$B_OK" == true ]] || FAILURES=$((FAILURES + 1))
[[ "$C_MORPH" == true && "$C_RESULT" == true && "$C_FILE" == true ]] || FAILURES=$((FAILURES + 1))
[[ "$D_RESULT" == true && "$D_FILE" == true && "$D_NO_MORPH" == true ]] || FAILURES=$((FAILURES + 1))

if [[ "$FAILURES" -eq 0 ]]; then
  echo "probe result: all checks passed"
  exit 0
fi
echo "probe result: $FAILURES check(s) failed"
exit 1
