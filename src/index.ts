import { logger } from './utils/logger';
import DatabaseConnection from './database/connection';
import TelegramBot from './bot';
import config from './config';

/**
 * Axie Marketplace Sweep Bot - Main Application Entry Point
 * 
 * This file initializes the database connection, runs migrations,
 * starts the Telegram bot, and handles graceful shutdown.
 */

// Flag to track if shutdown is in progress
let isShuttingDown = false;

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  try {
    logger.info('Starting Axie Marketplace Sweep Bot...');
    logger.info(`Environment: ${config.misc.nodeEnv}`);
    
    // Initialize database connection
    logger.info('Initializing database connection...');
    await DatabaseConnection.getConnection();
    logger.info('Database connection established');
    
    // Run database migrations
    logger.info('Running database migrations...');
    try {
      await DatabaseConnection.runMigrations();
      logger.info('Database migrations completed');
    } catch (migrationError) {
      logger.warn('Migration might already be up to date', { error: migrationError });
    }
    
    // Initialize and start Telegram bot
    logger.info('Initializing Telegram bot...');
    const bot = new TelegramBot();
    await bot.start();
    logger.info('Telegram bot started successfully');
    
    logger.info('Axie Marketplace Sweep Bot is now running');
    logger.info(`Bot version: 1.0.0`);
    
    // Set up graceful shutdown
    setupGracefulShutdown(bot);
  } catch (error) {
    logger.error('Failed to initialize application', { error });
    await shutdown(1);
  }
}

/**
 * Set up handlers for graceful shutdown
 * @param bot Telegram bot instance
 */
function setupGracefulShutdown(bot: TelegramBot): void {
  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal');
    await shutdown(0, bot);
  });
  
  // Handle SIGTERM (kill command)
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal');
    await shutdown(0, bot);
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception', { error });
    await shutdown(1, bot);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled promise rejection', { reason, promise });
    await shutdown(1, bot);
  });
}

/**
 * Perform graceful shutdown
 * @param exitCode Exit code
 * @param bot Optional Telegram bot instance
 */
async function shutdown(exitCode: number = 0, bot?: TelegramBot): Promise<void> {
  // Prevent multiple shutdown calls
  if (isShuttingDown) {
    return;
  }
  
  isShuttingDown = true;
  logger.info(`Shutting down with exit code: ${exitCode}`);
  
  try {
    // Stop Telegram bot if provided
    if (bot && bot.isActive()) {
      logger.info('Stopping Telegram bot...');
      await bot.stop();
      logger.info('Telegram bot stopped');
    }
    
    // Close database connection
    logger.info('Closing database connection...');
    await DatabaseConnection.closeConnection();
    logger.info('Database connection closed');
    
    // Final log message
    logger.info('Shutdown complete');
    
    // Allow logs to be flushed before exiting
    setTimeout(() => {
      process.exit(exitCode);
    }, 1000);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    
    // Force exit after a delay
    setTimeout(() => {
      process.exit(exitCode !== 0 ? exitCode : 1);
    }, 1000);
  }
}

// Start the application
initialize().catch((error) => {
  logger.error('Unhandled error during initialization', { error });
  process.exit(1);
});
