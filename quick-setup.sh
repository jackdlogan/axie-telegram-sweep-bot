#!/bin/bash
# =============================================================================
# Axie Marketplace Sweep Bot - Quick Setup Script
# =============================================================================
# This script configures just the essential settings for your Axie Sweep Bot:
# - Telegram Bot Token
# - Encryption Key
# - SQLite Database (for simplicity)
#
# Usage: ./quick-setup.sh
# =============================================================================

# Set text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

echo -e "\n${BLUE}=== Axie Marketplace Sweep Bot - Quick Setup ===${NC}"
echo -e "This script will configure the essential settings for your bot.\n"

# Check if .env file exists
if [ ! -f "$ENV_EXAMPLE" ]; then
  echo -e "${RED}Error: .env.example file not found${NC}"
  echo "Please make sure you're running this script from the project directory."
  exit 1
fi

# Create .env file from example if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo -e "${GREEN}Created .env file from .env.example${NC}"
else
  echo -e "${YELLOW}Found existing .env file. We'll update it with your new settings.${NC}"
  # Create a backup of the existing .env file
  cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d%H%M%S)"
  echo -e "${GREEN}Created backup of existing .env file${NC}"
fi

# Function to generate a secure random string
generate_random_string() {
  local length=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 $((length * 2)) | tr -dc 'a-zA-Z0-9' | head -c "$length"
  else
    # Fallback if openssl is not available
    cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c "$length"
  fi
}

# Function to update a variable in the .env file
update_env_var() {
  local var_name=$1
  local var_value=$2
  
  # Escape special characters for sed
  var_value=$(echo "$var_value" | sed 's/[\/&]/\\&/g')
  
  # Check if variable exists in .env file
  if grep -q "^$var_name=" "$ENV_FILE"; then
    # Update existing variable
    sed -i.bak "s/^$var_name=.*/$var_name=$var_value/" "$ENV_FILE"
  else
    # Add new variable
    echo "$var_name=$var_value" >> "$ENV_FILE"
  fi
  
  # Remove backup file created by sed on macOS
  rm -f "$ENV_FILE.bak"
}

# Create necessary directories
mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/logs" "$SCRIPT_DIR/sessions"
echo -e "${GREEN}Created necessary directories${NC}"

# Set database to SQLite for simplicity
update_env_var "DB_TYPE" "sqlite"
echo -e "${GREEN}Set database type to SQLite for simplicity${NC}"

# Telegram Bot Configuration
echo -e "\n${BLUE}1. Telegram Bot Configuration${NC}"
echo "You need to create a Telegram bot using @BotFather to get a bot token."
echo "Instructions: Open Telegram, search for @BotFather, send /newbot command,"
echo "choose a name and username for your bot."

read -p "Enter your Telegram Bot Token: " telegram_token
update_env_var "TELEGRAM_BOT_TOKEN" "$telegram_token"

echo -e "\nTo get your Telegram User ID, you can send a message to @userinfobot on Telegram."
read -p "Enter your Telegram User ID for admin access: " admin_ids
update_env_var "ADMIN_USER_IDS" "$admin_ids"

# Encryption Key
echo -e "\n${BLUE}2. Security Configuration${NC}"
echo "The encryption key is used to securely store wallet private keys."

read -p "Would you like to generate a random encryption key? (y/n, default: y): " generate_key
generate_key=${generate_key:-y}

if [[ $generate_key =~ ^[Yy]$ ]]; then
  encryption_key=$(generate_random_string 64)
  echo -e "${GREEN}Generated a secure 64-character encryption key${NC}"
else
  read -p "Enter your encryption key (min 32 chars): " encryption_key
  while [ ${#encryption_key} -lt 32 ]; do
    echo -e "${RED}Error: Encryption key must be at least 32 characters long${NC}"
    read -p "Enter your encryption key (min 32 chars): " encryption_key
  done
fi

update_env_var "ENCRYPTION_KEY" "$encryption_key"

# Final confirmation
echo -e "\n${GREEN}Quick setup completed successfully!${NC}"
echo -e "Your essential settings have been saved to: ${BLUE}$ENV_FILE${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Run 'npm run migrate' to set up the database"
echo "2. Run 'npm run dev' to start the bot in development mode"
echo -e "\n${GREEN}Happy sweeping!${NC}"
