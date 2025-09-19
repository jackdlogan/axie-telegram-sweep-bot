#!/bin/bash
# =============================================================================
# Axie Marketplace Sweep Bot - Direct Start Script
# =============================================================================
# This script starts the bot using ts-node directly, bypassing TypeScript
# compilation errors. It's a temporary solution until all TypeScript
# errors are fixed.
#
# Usage: ./start-bot.sh
# =============================================================================

# Set text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "\n${BLUE}=== Axie Marketplace Sweep Bot - Direct Start ===${NC}"

# Check if .env file exists
if [ ! -f ".env" ]; then
  echo -e "${RED}Error: .env file not found${NC}"
  echo -e "Please run ${YELLOW}./quick-setup.sh${NC} first to configure your bot."
  exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Node modules not found. Installing dependencies...${NC}"
  npm install
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install dependencies. Please run 'npm install' manually.${NC}"
    exit 1
  fi
  echo -e "${GREEN}Dependencies installed successfully.${NC}"
fi

# Check if ts-node is installed
if ! npm list -g ts-node > /dev/null 2>&1 && ! npm list ts-node > /dev/null 2>&1; then
  echo -e "${YELLOW}ts-node not found. Installing...${NC}"
  npm install -g ts-node
  if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Failed to install ts-node globally. Installing locally...${NC}"
    npm install --save-dev ts-node
    if [ $? -ne 0 ]; then
      echo -e "${RED}Failed to install ts-node. Please run 'npm install --save-dev ts-node' manually.${NC}"
      exit 1
    fi
  fi
  echo -e "${GREEN}ts-node installed successfully.${NC}"
fi

# Check for Telegram bot token in .env
if ! grep -q "TELEGRAM_BOT_TOKEN=" .env || grep -q "TELEGRAM_BOT_TOKEN=$" .env; then
  echo -e "${RED}Error: TELEGRAM_BOT_TOKEN not set in .env file${NC}"
  echo -e "Please run ${YELLOW}./quick-setup.sh${NC} to configure your bot."
  exit 1
fi

# Create necessary directories
mkdir -p data logs sessions
echo -e "${GREEN}Ensured necessary directories exist.${NC}"

# Run database migrations if needed
if [ ! -f "data/axie_bot.sqlite" ]; then
  echo -e "${YELLOW}Database not found. Running migrations...${NC}"
  npx knex migrate:latest
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to run database migrations. Please run 'npx knex migrate:latest' manually.${NC}"
    exit 1
  fi
  echo -e "${GREEN}Database migrations completed successfully.${NC}"
fi

# Start the bot with ts-node
echo -e "\n${GREEN}Starting Axie Marketplace Sweep Bot...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop the bot${NC}\n"

# Add TS_NODE_TRANSPILE_ONLY=1 to ignore type checking errors
export TS_NODE_TRANSPILE_ONLY=1

# Start with ts-node directly
if command -v npx &> /dev/null; then
  npx ts-node src/index.ts
else
  node_modules/.bin/ts-node src/index.ts
fi

# Check exit status
if [ $? -ne 0 ]; then
  echo -e "\n${RED}Bot exited with an error.${NC}"
  echo -e "Check the logs in the ${YELLOW}logs${NC} directory for more information."
  exit 1
fi

echo -e "\n${GREEN}Bot stopped.${NC}"
