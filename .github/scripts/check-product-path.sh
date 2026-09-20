#!/usr/bin/env bash
#
# Fail the build when the product path carries a test double, a placeholder or
# an unfinished marker.
#
# Judging criterion 2 is "deployed on Stellar Testnet with real functionality —
# not mocked or hardcoded", and the team's rule is stricter: one mock anywhere
# a judge can reach is an elimination. This is what stops one from arriving
# unnoticed, in the week where everybody is moving fast.
#
# Two files govern it and they are the only places to edit:
#   docs/disclosure/product-path.txt   what counts as the product path
#   docs/disclosure/mock-patterns.txt  what may not appear on it
#
# The script self-tests against docs/disclosure/guard-fixtures/ before it
# scans anything, so an emptied path list or a gutted pattern list fails
# loudly instead of reporting green over a repository it never looked at.
# docs/disclosure/mock-audit.md records what the first full scan found.
#
# Usage:
#   .github/scripts/check-product-path.sh              scan the product path
#   .github/scripts/check-product-path.sh --self-test  check the guard itself
#   .github/scripts/check-product-path.sh --list       print patterns and paths
#   .github/scripts/check-product-path.sh --files      print the files it scans

set -euo pipefail

# The same locale the phrase guard pins, and for the same reason: case folding
# has to mean one thing whether this runs on a stock macOS shell or an Ubuntu
# runner.
export LC_ALL=C.UTF-8

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PATTERNS_FILE="$ROOT/docs/disclosure/mock-patterns.txt"
PATHS_FILE="$ROOT/docs/disclosure/product-path.txt"
FIXTURE_VIOLATIONS="$ROOT/docs/disclosure/guard-fixtures/product-path-violations.txt"
FIXTURE_ALLOWED="$ROOT/docs/disclosure/guard-fixtures/product-path-allowed.txt"

# A line carrying this marker is a deliberate, reviewed exception. The line is
# marked, never the file, so the exception appears in the diff that introduces
# it and has to be argued for there.
ALLOW_MARKER='ci-allow-mock'

# Tests are where a test double belongs. The product path is what ships, and
# these are the parts of it that are not shipped: a file matching any of these
# is skipped even when its directory is on the path.
#
# `test.rs` and `tests.rs` are here because Rust keeps a crate's unit tests
# inside its own `src/`, behind `#[cfg(test)]`. They are compiled for `cargo
# test` and never reach the Wasm that is uploaded, so they are a test harness
# by construction, whatever directory they sit in.
TEST_PATTERNS='(^|/)(test|tests|__tests__)/|\.test\.|\.spec\.|(^|/)tests?\.rs$|_tests?\.rs$|(^|/)test-support/|(^|/)vitest\.config\.|(^|/)guard-fixtures/'

err() {
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::error::$*"
  else
    echo "error: $*" >&2
  fi
}

# Comments and blank lines out; everything else verbatim, into the named array.
read_list() {
  local file="$1" name="$2" line
  if [[ ! -f "$file" ]]; then
    err "missing: ${file#"$ROOT"/}"
    exit 1
  fi
  eval "$name=()"
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    eval "$name+=(\"\$line\")"
  done < "$file"
}

load() {
  read_list "$PATTERNS_FILE" PATTERNS
  read_list "$PATHS_FILE" PREFIXES
  if [[ ${#PATTERNS[@]} -eq 0 ]]; then
    err "docs/disclosure/mock-patterns.txt has no patterns — the guard would pass everything"
    exit 1
  fi
  if [[ ${#PREFIXES[@]} -eq 0 ]]; then
    err "docs/disclosure/product-path.txt has no paths — the guard would scan nothing"
    exit 1
  fi
}

# The matching pattern for a line, or nothing.
matching_pattern() {
  local text="$1" pattern
  for pattern in "${PATTERNS[@]}"; do
    if printf '%s\n' "$text" | grep -qiE -- "$pattern"; then
      printf '%s\n' "$pattern"
      return 0
    fi
  done
  return 1
}

files_to_scan() {
  local file prefix
  # --others --exclude-standard adds files that are new but not gitignored, so
  # a local run sees what CI will see once the change is committed.
  while IFS= read -r file; do
    [[ "$file" =~ $TEST_PATTERNS ]] && continue
    for prefix in "${PREFIXES[@]}"; do
      if [[ "$file" == "$prefix"* ]]; then
        printf '%s\n' "$file"
        break
      fi
    done
  done < <(git -C "$ROOT" ls-files --cached --others --exclude-standard)
}

self_test() {
  local failures=0 line hit

  if [[ ! -f "$FIXTURE_VIOLATIONS" || ! -f "$FIXTURE_ALLOWED" ]]; then
    err "guard fixtures missing under docs/disclosure/guard-fixtures/"
    return 1
  fi

  # Every line here is something the guard must catch. One slipping through
  # means a pattern was weakened or deleted.
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    if ! matching_pattern "$line" >/dev/null; then
      err "self-test: NOT caught by any pattern: $line"
      failures=$((failures + 1))
    fi
  done < "$FIXTURE_VIOLATIONS"

  # Every line here is honest code that must stay writable. A pattern that
  # fires on one of these makes the real thing unwritable.
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    if hit="$(matching_pattern "$line")"; then
      err "self-test: honest code wrongly flagged by /$hit/: $line"
      failures=$((failures + 1))
    fi
  done < "$FIXTURE_ALLOWED"

  if [[ $failures -gt 0 ]]; then
    err "self-test failed with $failures problem(s)"
    return 1
  fi
  echo "self-test passed: ${#PATTERNS[@]} pattern(s), ${#PREFIXES[@]} path prefix(es), fixtures behave as specified"
  return 0
}

scan() {
  local failures=0 pattern file matches
  FILES=()
  while IFS= read -r file; do
    FILES+=("$file")
  done < <(files_to_scan)

  if [[ ${#FILES[@]} -eq 0 ]]; then
    err "the product path matched no files — refusing to report a pass"
    return 1
  fi

  for pattern in "${PATTERNS[@]}"; do
    # -I skips binaries, -n gives the line number for the annotation. Marked
    # lines are dropped here rather than excluded earlier, so an exception
    # still has to survive pattern review.
    matches="$(grep -IniE -- "$pattern" "${FILES[@]}" 2>/dev/null | grep -v -- "$ALLOW_MARKER" || true)"
    if [[ -n "$matches" ]]; then
      while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        err "on the product path (/$pattern/): $line"
        failures=$((failures + 1))
      done <<< "$matches"
    fi
  done

  if [[ $failures -gt 0 ]]; then
    err "$failures finding(s) on the product path — see docs/disclosure/mock-audit.md"
    return 1
  fi
  echo "clean: ${#FILES[@]} product-path file(s) scanned against ${#PATTERNS[@]} pattern(s)"
  return 0
}

main() {
  load
  case "${1:-}" in
    --list)
      echo "# patterns"
      printf '%s\n' "${PATTERNS[@]}"
      echo "# path prefixes"
      printf '%s\n' "${PREFIXES[@]}"
      ;;
    --files)
      files_to_scan
      ;;
    --self-test)
      self_test
      ;;
    '')
      self_test
      scan
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
}

main "$@"
