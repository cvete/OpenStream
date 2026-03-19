#!/bin/bash

# Validate required environment variables before docker-compose up
# Usage: source .env && ./scripts/check-env.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0

check_var() {
    local name="$1"
    local value="${!name}"
    if [ -z "$value" ]; then
        echo -e "${RED}Missing: $name${NC}"
        ERRORS=$((ERRORS + 1))
    fi
}

check_secret() {
    local name="$1"
    local value="${!name}"
    if [ -z "$value" ]; then
        echo -e "${RED}Missing: $name${NC}"
        ERRORS=$((ERRORS + 1))
        return
    fi
    if [ ${#value} -lt 32 ]; then
        echo -e "${RED}$name must be at least 32 characters (current: ${#value})${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    if echo "$value" | grep -qiE 'change.?me|your-|default|change.?in.?production'; then
        echo -e "${RED}$name still contains a placeholder value${NC}"
        ERRORS=$((ERRORS + 1))
    fi
}

echo "Checking required environment variables..."

# Load .env if it exists
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

check_var "POSTGRES_USER"
check_var "POSTGRES_PASSWORD"
check_var "POSTGRES_DB"
check_secret "JWT_SECRET"
check_secret "TOKEN_SECRET"

if [ "$JWT_SECRET" = "$TOKEN_SECRET" ] && [ -n "$JWT_SECRET" ]; then
    echo -e "${RED}JWT_SECRET and TOKEN_SECRET must be different values${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo -e "${RED}Found $ERRORS error(s). Fix them before starting.${NC}"
    echo "See .env.production.example for guidance."
    exit 1
fi

echo -e "${GREEN}All required environment variables are set.${NC}"
