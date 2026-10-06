#!/usr/bin/env bash
set -euo pipefail

# CI pipeline for EnglishForge
# Usage: bash scripts/ci.sh [build|test|lint|all]

TARGET="${1:-all}"

echo "=== EnglishForge CI Pipeline ==="
echo "Target: $TARGET"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }
info() { echo -e "${YELLOW}▶ $1${NC}"; }

# Install dependencies
install_deps() {
  info "Installing dependencies..."
  corepack enable
  pnpm install --frozen-lockfile
  pass "Dependencies installed"
}

# TypeScript type check
typecheck() {
  info "Running TypeScript type check..."
  pnpm --filter @eng-forge/api typecheck 2>&1 && pass "API type check passed" || fail "API type check failed"
  pnpm --filter @eng-forge/web typecheck 2>&1 && pass "Web type check passed" || fail "Web type check failed"
}

# API tests
run_api_tests() {
  info "Running API tests..."
  pnpm --filter @eng-forge/api test 2>&1 && pass "API tests passed" || fail "API tests failed"
}

# Web tests
run_web_tests() {
  info "Running Web tests..."
  pnpm --filter @eng-forge/web test 2>&1 && pass "Web tests passed" || fail "Web tests failed"
}

# Python tests
run_python_tests() {
  info "Running Python tests..."

  cd apps/speech
  pip install -e ".[dev]" 2>&1 | tail -1
  pytest --tb=short -q && pass "Speech tests passed" || fail "Speech tests failed"

  cd ../ai
  pip install -e ".[dev]" 2>&1 | tail -1
  pytest --tb=short -q && pass "AI tests passed" || fail "AI tests failed"

  cd ../..
}

# Lint
lint() {
  info "Running linters..."
  pnpm --filter @eng-forge/api lint 2>&1 && pass "API lint passed" || fail "API lint failed"
  pnpm --filter @eng-forge/web lint 2>&1 && pass "Web lint passed" || fail "Web lint failed"

  cd apps/speech
  ruff check . && pass "Speech ruff passed" || fail "Speech ruff failed"

  cd ../ai
  ruff check . && pass "AI ruff passed" || fail "AI ruff failed"

  cd ../..
}

# Build
build() {
  info "Building all services..."
  pnpm --filter @eng-forge/api build 2>&1 && pass "API build passed" || fail "API build failed"
  pnpm --filter @eng-forge/web build 2>&1 && pass "Web build passed" || fail "Web build failed"
}

case "$TARGET" in
  install) install_deps ;;
  typecheck) typecheck ;;
  test) run_api_tests; run_web_tests; run_python_tests ;;
  lint) lint ;;
  build) build ;;
  all)
    install_deps
    typecheck
    run_api_tests
    run_web_tests
    lint
    build
    ;;
  *)
    echo "Usage: $0 [install|typecheck|test|lint|build|all]"
    exit 1
    ;;
esac

echo ""
echo "=== CI Pipeline Complete ==="
