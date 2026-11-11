#!/bin/sh
# Installs the p3 skills on disk without cloning the repository.
#
#   curl -fsSL https://raw.githubusercontent.com/osmelmora/p3-executor/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/osmelmora/p3-executor/main/install.sh | sh -s -- --standalone
#
# Downloads the repository at P3_REF (default: main) into a temporary directory, runs
# scripts/install-local.ts from it with the arguments given here, and removes the download.
# Arguments are the installer's own: --project <dir>, --claude, --codex, --standalone, --uninstall, --help.
set -eu

repo="${P3_REPO:-osmelmora/p3-executor}"
ref="${P3_REF:-main}"

fail() {
  echo "p3 install: $1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 24 or newer, then run this again."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
command -v tar >/dev/null 2>&1 || fail "tar is not installed."

# The installer is TypeScript and runs on Node's built-in type stripping.
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' ||
  fail "Node $(node --version) is too old. Install Node 24 or newer, then run this again."

tmp="$(mktemp -d "${TMPDIR:-/tmp}/p3-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading $repo at $ref..."
curl -fsSL -o "$tmp/source.tar.gz" "https://codeload.github.com/$repo/tar.gz/$ref" ||
  fail "could not download $repo at $ref."
mkdir "$tmp/source"
tar -xzf "$tmp/source.tar.gz" -C "$tmp/source" --strip-components 1 || fail "could not unpack the download."
[ -f "$tmp/source/scripts/install-local.ts" ] || fail "$repo at $ref has no scripts/install-local.ts."

node "$tmp/source/scripts/install-local.ts" "$@"
