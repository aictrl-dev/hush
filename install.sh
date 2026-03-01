#!/bin/bash

# hush 🛡️ - One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/aictrl-dev/hush/master/install.sh | sh

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Installing hush 🛡️ - The Semantic Security Gateway...${NC}"

# Check for Node.js
if ! [ -x "$(command -v node)" ]; then
  echo 'Error: Node.js is not installed. Please install Node.js 18+ first.' >&2
  exit 1
fi

# Check for npm
if ! [ -x "$(command -v npm)" ]; then
  echo 'Error: npm is not installed.' >&2
  exit 1
fi

# Install hush
echo "Running: npm install -g @aictrl/hush"
npm install -g @aictrl/hush --silent

echo -e "${GREEN}Successfully installed hush!${NC}"
echo ""
echo "To get started:"
echo "  1. Run 'hush --dashboard' to start the gateway."
echo "  2. Point your tools to http://127.0.0.1:4000"
echo ""
echo "Documentation: https://github.com/aictrl-dev/hush"
