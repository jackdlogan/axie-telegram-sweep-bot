#!/bin/bash
# =============================================================================
# Axie Marketplace Sweep Bot - Interactive Environment Setup Script
# =============================================================================
# This script helps you configure the essential environment variables
# for the Axie Marketplace Sweep Bot.
#
# Usage: ./setup-env.sh
# =============================================================================

# Set text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd 2>/dev/null || echo "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

# Check if .env file exists
if [ ! -f "$ENV_EXAMPLE" ]; then
  echo -e "${RED}Error: .env.example file not found in $PROJECT_ROOT${NC}"
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

echo -e "\n${BLUE}=== Axie Marketplace Sweep Bot Configuration ===${NC}"
echo -e "This script will help you configure the essential settings for your bot.\n"

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

# Telegram Bot Configuration
echo -e "\n${BLUE}1. Telegram Bot Configuration${NC}"
echo "You need to create a Telegram bot using @BotFather to get a bot token."
echo "Instructions: Open Telegram, search for @BotFather, send /newbot command,"
echo "choose a name and username for your bot."

read -p "Enter your Telegram Bot Token: " telegram_token
update_env_var "TELEGRAM_BOT_TOKEN" "$telegram_token"

echo -e "\nTo get your Telegram User ID, you can send a message to @userinfobot on Telegram."
read -p "Enter your Telegram User ID for admin access (comma-separated for multiple): " admin_ids
update_env_var "ADMIN_USER_IDS" "$admin_ids"

# Encryption Key
echo -e "\n${BLUE}2. Security Configuration${NC}"
echo "The encryption key is used to securely store wallet private keys."
echo "It should be at least 32 characters long and kept secret."

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

# Database Configuration
echo -e "\n${BLUE}3. Database Configuration${NC}"
echo "The bot can use either PostgreSQL or SQLite for data storage."

read -p "Which database would you like to use? (postgres/sqlite, default: sqlite): " db_type
db_type=${db_type:-sqlite}
update_env_var "DB_TYPE" "$db_type"

if [[ $db_type =~ ^[Pp]ostgres$ ]]; then
  echo -e "\n${YELLOW}PostgreSQL Configuration:${NC}"
  read -p "PostgreSQL Host (default: localhost): " pg_host
  pg_host=${pg_host:-localhost}
  update_env_var "POSTGRES_HOST" "$pg_host"
  
  read -p "PostgreSQL Port (default: 5432): " pg_port
  pg_port=${pg_port:-5432}
  update_env_var "POSTGRES_PORT" "$pg_port"
  
  read -p "PostgreSQL User (default: axie_bot_user): " pg_user
  pg_user=${pg_user:-axie_bot_user}
  update_env_var "POSTGRES_USER" "$pg_user"
  
  read -p "PostgreSQL Password: " pg_password
  update_env_var "POSTGRES_PASSWORD" "$pg_password"
  
  read -p "PostgreSQL Database Name (default: axie_bot_db): " pg_db
  pg_db=${pg_db:-axie_bot_db}
  update_env_var "POSTGRES_DB" "$pg_db"
else
  echo -e "\n${YELLOW}SQLite Configuration:${NC}"
  read -p "SQLite Database File (default: ./data/axie_bot.sqlite): " sqlite_file
  sqlite_file=${sqlite_file:-./data/axie_bot.sqlite}
  update_env_var "SQLITE_FILENAME" "$sqlite_file"
  
  # Create data directory if it doesn't exist
  mkdir -p "$(dirname "$sqlite_file")"
fi

# Blockchain Configuration
echo -e "\n${BLUE}4. Blockchain Configuration${NC}"
echo "The bot needs to connect to the Ronin blockchain."

read -p "Ronin Mainnet RPC URL (default: https://api.roninchain.com/rpc): " ronin_rpc
ronin_rpc=${ronin_rpc:-https://api.roninchain.com/rpc}
update_env_var "RONIN_MAINNET_RPC" "$ronin_rpc"

# Optional Redis Configuration
echo -e "\n${BLUE}5. Redis Configuration (Optional)${NC}"
echo "Redis can be used for caching to improve performance."

read -p "Enable Redis? (y/n, default: n): " enable_redis
enable_redis=${enable_redis:-n}

if [[ $enable_redis =~ ^[Yy]$ ]]; then
  update_env_var "REDIS_ENABLED" "true"
  
  read -p "Redis Host (default: localhost): " redis_host
  redis_host=${redis_host:-localhost}
  update_env_var "REDIS_HOST" "$redis_host"
  
  read -p "Redis Port (default: 6379): " redis_port
  redis_port=${redis_port:-6379}
  update_env_var "REDIS_PORT" "$redis_port"
  
  read -p "Redis Password (leave empty for none): " redis_password
  update_env_var "REDIS_PASSWORD" "$redis_password"
else
  update_env_var "REDIS_ENABLED" "false"
fi

# Transaction Limits
echo -e "\n${BLUE}6. Transaction Limits${NC}"
echo "Setting reasonable transaction limits helps prevent accidental overspending."

read -p "Maximum RON per transaction (default: 10): " max_tx_amount
max_tx_amount=${max_tx_amount:-10}
update_env_var "MAX_TRANSACTION_AMOUNT" "$max_tx_amount"

read -p "Maximum RON per day (default: 50): " max_daily_amount
max_daily_amount=${max_daily_amount:-50}
update_env_var "MAX_DAILY_TRANSACTION_AMOUNT" "$max_daily_amount"

read -p "Maximum Axies per sweep (default: 100): " max_sweep_quantity
max_sweep_quantity=${max_sweep_quantity:-100}
update_env_var "MAX_SWEEP_QUANTITY" "$max_sweep_quantity"

# Environment
echo -e "\n${BLUE}7. Environment Configuration${NC}"

read -p "Node environment (development/production, default: development): " node_env
node_env=${node_env:-development}
update_env_var "NODE_ENV" "$node_env"

# Final confirmation
echo -e "\n${GREEN}Configuration completed successfully!${NC}"
echo -e "Your settings have been saved to: ${BLUE}$ENV_FILE${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Run 'npm install' to install dependencies (if not done already)"
echo "2. Run 'npm run migrate' to set up the database"
echo "3. Run 'npm run dev' to start the bot in development mode"
echo "   or 'npm run build && npm start' for production"
echo -e "\n${GREEN}Happy sweeping!${NC}"
