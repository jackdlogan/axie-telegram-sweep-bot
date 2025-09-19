import { Telegraf, Context, session, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import LocalSession from 'telegraf-session-local';
import config from '../config';
import Logger from '../utils/logger';
import DatabaseConnection from '../database/connection';

// Import command handlers (these will be implemented in separate files)
import { handleStartCommand } from './commands/start';
import { handleWalletCommand, handleWalletCallback } from './commands/wallet';
import { handleSweepCommand, handleSweepCallback } from './commands/sweep';
import { handleBalanceCommand } from './commands/balance';
import { handleHistoryCommand } from './commands/history';
import { handleSettingsCommand, handleSettingsCallback } from './commands/settings';
import { handleHelpCommand } from './commands/help';

// Define custom session type
interface BotSession {
  // User state
  userId?: number;
  username?: string;
  
  // Wallet management state
  walletAction?: 'create' | 'import' | 'list' | 'delete' | 'select';
  selectedWalletId?: number;
  
  // Sweep state
  sweepCollection?: string;
  sweepQuantity?: number;
  sweepMaxPrice?: number;
  sweepConfirmation?: boolean;
  
  // Temporary storage for sensitive data (cleared after use)
  tempPrivateKey?: string;
  tempSeedPhrase?: string;
  
  // UI state tracking
  currentMenu?: string;
  messageToEdit?: number;
  
  // Last action timestamp for rate limiting
  lastActionTime?: number;
}

// Extend the context to include our custom session
interface BotContext extends Context {
  session: BotSession;
  dbConnection: any; // Database connection
}

/**
 * Main Telegram Bot class for Axie Marketplace Sweep Bot
 */
class TelegramBot {
  private bot: Telegraf<BotContext>;
  private logger: Logger;
  private isRunning: boolean = false;

  /**
   * Constructor
   */
  constructor() {
    this.logger = new Logger('telegram-bot');
    
    // Initialize bot with token from config
    this.bot = new Telegraf<BotContext>(config.telegram.botToken);
    
    // Set up middleware and handlers
    this.setupMiddleware();
    this.setupCommandHandlers();
    this.setupCallbackHandlers();
    this.setupErrorHandling();
    
    this.logger.info('Telegram bot initialized');
  }

  /**
   * Set up middleware for the bot
   */
  private setupMiddleware(): void {
    // Set up session middleware
    const sessionMiddleware = new LocalSession({
      database: 'sessions/sessions.json',
      property: 'session',
      storage: LocalSession.storageMemory,
      format: {
        serialize: (obj: any) => JSON.stringify(obj, null, 2),
        deserialize: (str: string) => JSON.parse(str),
      },
      state: { }
    });
    
    this.bot.use(sessionMiddleware.middleware());
    
    // Add database connection to context
    this.bot.use(async (ctx, next) => {
      try {
        ctx.dbConnection = await DatabaseConnection.getConnection();
        return next();
      } catch (error) {
        this.logger.error('Failed to establish database connection in middleware', { error });
        await ctx.reply('Error connecting to database. Please try again later.');
      }
    });
    
    // User tracking middleware
    this.bot.use(async (ctx, next) => {
      // Skip if not a message or callback query
      if (!ctx.message && !ctx.callbackQuery) {
        return next();
      }
      
      try {
        // Get user information
        const userId = ctx.from?.id;
        const username = ctx.from?.username;
        
        if (userId) {
          // Store user ID in session
          ctx.session.userId = userId;
          ctx.session.username = username;
          
          // Check if user exists in database, if not create them
          const userExists = await ctx.dbConnection('users')
            .where({ telegram_id: userId })
            .first();
            
          if (!userExists) {
            await ctx.dbConnection('users').insert({
              telegram_id: userId,
              username: username || null,
              created_at: new Date(),
              updated_at: new Date()
            });
            
            this.logger.info(`New user registered: ${userId}`);
          }
        }
        
        return next();
      } catch (error) {
        this.logger.error('Error in user tracking middleware', { error, userId: ctx.from?.id });
        return next();
      }
    });
    
    // Rate limiting middleware
    this.bot.use(async (ctx, next) => {
      const now = Date.now();
      const minInterval = 500; // Minimum time between actions in ms
      
      if (ctx.session.lastActionTime && (now - ctx.session.lastActionTime) < minInterval) {
        // Too many requests, ignore this one
        return;
      }
      
      // Update last action time
      ctx.session.lastActionTime = now;
      
      return next();
    });
  }

  /**
   * Set up command handlers
   */
  private setupCommandHandlers(): void {
    // Start command - Introduction and initial setup
    this.bot.command('start', handleStartCommand);
    
    // Wallet management commands
    this.bot.command('wallet', handleWalletCommand);
    
    // Sweep command - Start the sweeping process
    this.bot.command('sweep', handleSweepCommand);
    
    // Balance command - Check wallet balances
    this.bot.command('balance', handleBalanceCommand);
    
    // History command - View transaction history
    this.bot.command('history', handleHistoryCommand);
    
    // Settings command - Configure user preferences
    this.bot.command('settings', handleSettingsCommand);
    
    // Help command - Show available commands and instructions
    this.bot.command('help', handleHelpCommand);
    
    // Handle text messages (for collecting private keys, seed phrases, etc.)
    this.bot.on(message('text'), async (ctx) => {
      const text = ctx.message.text;
      
      // Clear message for security if it might contain sensitive information
      try {
        await ctx.deleteMessage();
      } catch (error) {
        this.logger.warn('Could not delete potential sensitive message', { error });
      }
      
      // Handle based on current state
      if (ctx.session.walletAction === 'import') {
        // Store private key or seed phrase temporarily
        if (text.startsWith('0x') && text.length === 66) {
          ctx.session.tempPrivateKey = text;
          await ctx.reply('Private key received. Please provide a name for this wallet:');
          ctx.session.walletAction = 'import_name';
        } else if (text.split(' ').length >= 12) {
          ctx.session.tempSeedPhrase = text;
          await ctx.reply('Seed phrase received. Please provide a name for this wallet:');
          ctx.session.walletAction = 'import_name';
        } else {
          await ctx.reply('Invalid private key or seed phrase. Please try again or use /cancel to abort.');
        }
      } else if (ctx.session.walletAction === 'import_name') {
        const walletName = text;
        
        // Import wallet with the provided name
        // This will be implemented in the wallet service
        await ctx.reply(`Wallet "${walletName}" is being imported. Please wait...`);
        
        // Clear sensitive data from session
        ctx.session.tempPrivateKey = undefined;
        ctx.session.tempSeedPhrase = undefined;
        ctx.session.walletAction = undefined;
        
        // Actual wallet import logic will be implemented in the wallet service
        await ctx.reply(`Wallet "${walletName}" has been imported successfully.`);
      } else if (ctx.session.sweepMaxPrice !== undefined) {
        // Handle custom max price input for sweep
        const maxPrice = parseFloat(text);
        
        if (isNaN(maxPrice) || maxPrice <= 0) {
          await ctx.reply('Invalid price. Please enter a valid number or use /cancel to abort.');
        } else {
          ctx.session.sweepMaxPrice = maxPrice;
          
          // Continue with sweep process
          // This will be implemented in the sweep command handler
          await ctx.reply(`Maximum price set to ${maxPrice} RON.`);
          
          // Show sweep confirmation
          // Implementation will be in the sweep command handler
        }
      } else {
        // Unknown text input
        await ctx.reply('I\'m not sure what you want to do. Please use one of the available commands:\n/wallet - Manage wallets\n/sweep - Start sweeping\n/balance - Check balances\n/history - View history\n/settings - Configure settings\n/help - Show help');
      }
    });
  }

  /**
   * Set up callback query handlers for inline keyboards
   */
  private setupCallbackHandlers(): void {
    // Handle wallet-related callbacks
    this.bot.action(/^wallet:(.+)$/, handleWalletCallback);
    
    // Handle sweep-related callbacks
    this.bot.action(/^sweep:(.+)$/, handleSweepCallback);
    
    // Handle settings-related callbacks
    this.bot.action(/^settings:(.+)$/, handleSettingsCallback);
    
    // Generic cancel action
    this.bot.action('cancel', async (ctx) => {
      // Clear session state
      ctx.session.walletAction = undefined;
      ctx.session.sweepCollection = undefined;
      ctx.session.sweepQuantity = undefined;
      ctx.session.sweepMaxPrice = undefined;
      ctx.session.sweepConfirmation = undefined;
      ctx.session.tempPrivateKey = undefined;
      ctx.session.tempSeedPhrase = undefined;
      
      // Edit message if it's a callback query
      if (ctx.callbackQuery) {
        await ctx.editMessageText('Operation cancelled.');
      } else {
        await ctx.reply('Operation cancelled.');
      }
    });
  }

  /**
   * Set up error handling
   */
  private setupErrorHandling(): void {
    // Global error handler
    this.bot.catch((err, ctx) => {
      this.logger.error('Bot error', { error: err, updateType: ctx.updateType });
      
      // Send error message to user
      ctx.reply('An error occurred while processing your request. Please try again later.')
        .catch(e => this.logger.error('Failed to send error message to user', { error: e }));
      
      // If we're in development mode, send more details
      if (config.misc.nodeEnv === 'development') {
        ctx.reply(`Error details: ${err.message}`)
          .catch(e => this.logger.error('Failed to send error details to user', { error: e }));
      }
    });
  }

  /**
   * Start the bot
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Bot is already running');
      return;
    }
    
    try {
      // Launch the bot
      await this.bot.launch();
      this.isRunning = true;
      this.logger.info('Bot started successfully');
      
      // Handle graceful shutdown
      process.once('SIGINT', () => this.stop('SIGINT'));
      process.once('SIGTERM', () => this.stop('SIGTERM'));
    } catch (error) {
      this.logger.error('Failed to start bot', { error });
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  public async stop(signal?: string): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Bot is not running');
      return;
    }
    
    try {
      // Stop the bot
      await this.bot.stop(signal);
      this.isRunning = false;
      this.logger.info(`Bot stopped${signal ? ` (${signal})` : ''}`);
    } catch (error) {
      this.logger.error('Failed to stop bot', { error });
      throw error;
    }
  }

  /**
   * Check if the bot is running
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get the Telegraf bot instance
   */
  public getInstance(): Telegraf<BotContext> {
    return this.bot;
  }
}

export default TelegramBot;
