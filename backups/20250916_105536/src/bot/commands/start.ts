import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';

// Initialize logger
const logger = new Logger('command:start');

/**
 * Handle the /start command
 * This is the entry point for new users
 */
export async function handleStartCommand(ctx: Context): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    const username = ctx.from?.username || ctx.from?.first_name || 'there';
    
    logger.info('Start command received', { userId, username });
    
    // Welcome message with bot introduction
    const welcomeMessage = `
🎮 *Welcome to Axie Marketplace Sweep Bot* 🎮

Hello ${username}! I'm your automated assistant for sweeping (bulk purchasing) Axies from the Axie Infinity Marketplace.

*What I can do:*
• Create and manage Ronin wallets
• Analyze Axie collections and prices
• Automate bulk purchases of Axies
• Track your transaction history
• Monitor your wallet balances

*Getting Started:*
1️⃣ First, you'll need to set up a wallet using the /wallet command
2️⃣ Check collection prices with /sweep
3️⃣ Configure and execute your first sweep

*Security Note:*
Your private keys and seed phrases are encrypted and never stored in plaintext. You can always use your own wallet by importing it.
    `;
    
    // Create inline keyboard for quick actions
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔑 Setup Wallet', 'wallet:setup'),
        Markup.button.callback('💰 Check Balance', 'wallet:balance')
      ],
      [
        Markup.button.callback('🧹 Start Sweeping', 'sweep:start'),
        Markup.button.callback('📊 Collection Stats', 'sweep:stats')
      ],
      [
        Markup.button.callback('❓ Help & Commands', 'help:commands')
      ]
    ]);
    
    // Send welcome message with keyboard
    await ctx.replyWithMarkdown(welcomeMessage, keyboard);
    
    // Check if user has any wallets
    const userWallets = await ctx.dbConnection('wallets')
      .where({ user_id: userId })
      .count('id as count')
      .first();
    
    const walletCount = parseInt(userWallets?.count || '0');
    
    // If user has no wallets, prompt them to create one
    if (walletCount === 0) {
      setTimeout(async () => {
        await ctx.reply(
          '🔑 I notice you don\'t have any wallets set up yet. Would you like to create a new wallet or import an existing one?',
          Markup.inlineKeyboard([
            [
              Markup.button.callback('🆕 Create New Wallet', 'wallet:create'),
              Markup.button.callback('📥 Import Existing Wallet', 'wallet:import')
            ]
          ])
        );
      }, 2000); // Small delay for better UX
    }
    
    logger.info('Start command completed', { userId });
  } catch (error) {
    logger.error('Error handling start command', { error });
    await ctx.reply('Sorry, there was an error starting the bot. Please try again later.');
  }
}
