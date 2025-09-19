#!/bin/bash
# =============================================================================
# Axie Marketplace Sweep Bot - Production Deployment Script
# =============================================================================
# This script automates the deployment process for the Axie Sweep Bot
# including environment checks, database migrations, and Docker deployment
# with rollback capability.
#
# Usage: ./scripts/deploy.sh [--no-backup] [--force] [--skip-migrations]
# 
# Options:
#   --no-backup       Skip backup creation before deployment
#   --force           Force deployment even if checks fail
#   --skip-migrations Skip running database migrations
#
# =============================================================================

# Exit on error, undefined variables, and propagate pipe errors
set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Configuration
DOCKER_COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"
BACKUP_DIR="$PROJECT_ROOT/backups"
LOG_DIR="$PROJECT_ROOT/logs"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/deploy_$TIMESTAMP.log"
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"
HEALTH_CHECK_RETRIES=10
HEALTH_CHECK_INTERVAL=5

# Command line arguments
NO_BACKUP=false
FORCE_DEPLOY=false
SKIP_MIGRATIONS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-backup)
      NO_BACKUP=true
      shift
      ;;
    --force)
      FORCE_DEPLOY=true
      shift
      ;;
    --skip-migrations)
      SKIP_MIGRATIONS=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--no-backup] [--force] [--skip-migrations]"
      exit 1
      ;;
  esac
done

# Create necessary directories
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

# Setup logging
exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== Deployment started at $(date) ==="
echo "Deployment log: $LOG_FILE"

# Function to log messages with timestamps
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to log errors and exit
error() {
  log "ERROR: $1"
  exit 1
}

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to create a backup
create_backup() {
  if [ "$NO_BACKUP" = true ]; then
    log "Skipping backup creation (--no-backup flag set)"
    return 0
  fi
  
  log "Creating backup of current deployment..."
  
  # Check if Docker Compose is running
  if docker-compose ps | grep -q "Up"; then
    # Backup Docker volumes
    log "Backing up Docker volumes..."
    docker-compose down
    
    # Create backup directory structure
    mkdir -p "$BACKUP_DIR/data"
    
    # Backup environment file
    if [ -f "$ENV_FILE" ]; then
      cp "$ENV_FILE" "$BACKUP_DIR/data/"
    fi
    
    # Backup Docker Compose file
    if [ -f "$DOCKER_COMPOSE_FILE" ]; then
      cp "$DOCKER_COMPOSE_FILE" "$BACKUP_DIR/data/"
    fi
    
    # Create compressed backup
    tar -czf "$BACKUP_FILE" -C "$BACKUP_DIR/data" .
    rm -rf "$BACKUP_DIR/data"
    
    log "Backup created: $BACKUP_FILE"
    
    # Restart Docker Compose
    docker-compose up -d
  else
    log "No running Docker containers found, creating file-only backup..."
    
    # Create backup directory structure
    mkdir -p "$BACKUP_DIR/data"
    
    # Backup environment file
    if [ -f "$ENV_FILE" ]; then
      cp "$ENV_FILE" "$BACKUP_DIR/data/"
    fi
    
    # Backup Docker Compose file
    if [ -f "$DOCKER_COMPOSE_FILE" ]; then
      cp "$DOCKER_COMPOSE_FILE" "$BACKUP_DIR/data/"
    fi
    
    # Create compressed backup
    tar -czf "$BACKUP_FILE" -C "$BACKUP_DIR/data" .
    rm -rf "$BACKUP_DIR/data"
    
    log "File-only backup created: $BACKUP_FILE"
  fi
}

# Function to perform rollback
rollback() {
  log "Deployment failed. Rolling back..."
  
  if [ ! -f "$BACKUP_FILE" ]; then
    error "Backup file not found: $BACKUP_FILE. Manual intervention required."
  fi
  
  # Stop current deployment
  docker-compose down || true
  
  # Extract backup
  mkdir -p "$BACKUP_DIR/restore"
  tar -xzf "$BACKUP_FILE" -C "$BACKUP_DIR/restore"
  
  # Restore files
  if [ -f "$BACKUP_DIR/restore/$ENV_FILE" ]; then
    cp "$BACKUP_DIR/restore/$ENV_FILE" "$PROJECT_ROOT/"
  fi
  
  if [ -f "$BACKUP_DIR/restore/$DOCKER_COMPOSE_FILE" ]; then
    cp "$BACKUP_DIR/restore/$DOCKER_COMPOSE_FILE" "$PROJECT_ROOT/"
  fi
  
  # Restart from backup
  docker-compose up -d
  
  # Clean up
  rm -rf "$BACKUP_DIR/restore"
  
  log "Rollback completed. Previous version restored."
  exit 1
}

# Function to check environment
check_environment() {
  log "Checking environment..."
  
  # Check for required tools
  for cmd in docker docker-compose git node npm; do
    if ! command_exists "$cmd"; then
      if [ "$FORCE_DEPLOY" = true ]; then
        log "WARNING: $cmd is not installed, but continuing due to --force flag"
      else
        error "$cmd is not installed. Please install it and try again."
      fi
    fi
  done
  
  # Check for environment file
  if [ ! -f "$ENV_FILE" ]; then
    error "Environment file $ENV_FILE not found. Please create it based on .env.example"
  fi
  
  # Check for required environment variables
  required_vars=("TELEGRAM_BOT_TOKEN" "ENCRYPTION_KEY")
  source "$ENV_FILE"
  
  for var in "${required_vars[@]}"; do
    if [ -z "${!var:-}" ]; then
      if [ "$FORCE_DEPLOY" = true ]; then
        log "WARNING: Required environment variable $var is not set, but continuing due to --force flag"
      else
        error "Required environment variable $var is not set in $ENV_FILE"
      fi
    fi
  done
  
  log "Environment check completed"
}

# Function to update code
update_code() {
  log "Updating code from repository..."
  
  # Check if we're in a git repository
  if [ -d ".git" ]; then
    # Save current branch
    current_branch=$(git symbolic-ref --short HEAD)
    
    # Fetch latest changes
    git fetch --all
    
    # Check for local changes
    if git diff-index --quiet HEAD --; then
      # No local changes, safe to pull
      git pull origin "$current_branch"
    else
      if [ "$FORCE_DEPLOY" = true ]; then
        log "WARNING: Local changes detected, but continuing due to --force flag"
        git stash
        git pull origin "$current_branch"
        git stash pop || true
      else
        error "Local changes detected. Please commit or stash them before deploying."
      fi
    fi
  else
    log "Not a git repository, skipping code update"
  fi
  
  log "Code update completed"
}

# Function to build and deploy
build_and_deploy() {
  log "Building and deploying application..."
  
  # Build and start containers
  docker-compose build --no-cache
  docker-compose up -d
  
  log "Deployment completed"
}

# Function to run database migrations
run_migrations() {
  if [ "$SKIP_MIGRATIONS" = true ]; then
    log "Skipping database migrations (--skip-migrations flag set)"
    return 0
  fi
  
  log "Running database migrations..."
  
  # Wait for database to be ready
  log "Waiting for database to be ready..."
  for i in $(seq 1 10); do
    if docker-compose exec -T db pg_isready 2>/dev/null; then
      break
    fi
    
    if [ "$i" -eq 10 ]; then
      if [ "$FORCE_DEPLOY" = true ]; then
        log "WARNING: Database is not ready after 10 attempts, but continuing due to --force flag"
      else
        error "Database is not ready after 10 attempts. Deployment failed."
      fi
    fi
    
    log "Database not ready, waiting 5 seconds..."
    sleep 5
  done
  
  # Run migrations
  docker-compose exec -T bot yarn migrate || docker-compose exec -T bot npm run migrate
  
  log "Database migrations completed"
}

# Function to check application health
check_health() {
  log "Checking application health..."
  
  for i in $(seq 1 $HEALTH_CHECK_RETRIES); do
    if docker-compose ps | grep -q "bot.*Up"; then
      log "Application is running"
      return 0
    fi
    
    log "Application not healthy, waiting $HEALTH_CHECK_INTERVAL seconds... (attempt $i/$HEALTH_CHECK_RETRIES)"
    sleep $HEALTH_CHECK_INTERVAL
  done
  
  if [ "$FORCE_DEPLOY" = true ]; then
    log "WARNING: Application health check failed, but continuing due to --force flag"
    return 0
  else
    log "Application health check failed after $HEALTH_CHECK_RETRIES attempts"
    return 1
  fi
}

# Main deployment process
main() {
  log "Starting deployment process..."
  
  # Check environment
  check_environment
  
  # Create backup for potential rollback
  create_backup
  
  # Update code
  update_code
  
  # Build and deploy
  build_and_deploy
  
  # Run database migrations
  run_migrations
  
  # Check application health
  if ! check_health; then
    rollback
  fi
  
  log "Deployment successful!"
}

# Run the main function
main

# Exit successfully
exit 0
