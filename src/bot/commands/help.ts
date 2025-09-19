// @ts-nocheck
import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';

// Initialize logger
const logger = new Logger('command:help');

/**
 * Handle the /help command
 * Shows comprehensive help information and command descriptions
 */
export async function handleHelpCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('Help command received', { userId });
    
    // Show main help menu
    await showHelpMenu(ctx);
    
    logger.info('Help command completed', { userId });
  } catch (error) {
    logger.error('Error handling help command', { error });
    await ctx.reply('Sorry, there was an error displaying the help information. Please try again later.');
  }
}

/**
 * Show the main help menu
 * @param ctx Context
 */
async function showHelpMenu(ctx: any): Promise<void> {
  try {
    const message = `
❓ *Axie Marketplace Sweep Bot Help*

Welcome to the help section! This bot allows you to automate bulk purchasing (sweeping) of Axies from the Axie Infinity Marketplace.

*Available Commands:*
• /start - Initialize the bot and get started
• /wallet - Manage your Ronin wallets
• /marketplace - Browse Axie marketplace listings and sweep Axies
• /balance - Check your wallet balances
• /history - View your transaction history
• /settings - Configure your preferences
• /help - Show this help information

Select a topic below to learn more:
    `;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📚 Commands', 'help:commands'),
        Markup.button.callback('🧹 Sweeping Guide', 'help:sweep_guide')
      ],
      [
        Markup.button.callback('🔑 Wallet Guide', 'help:wallet_guide'),
        Markup.button.callback('❓ FAQ', 'help:faq')
      ],
      [
        Markup.button.callback('🔧 Troubleshooting', 'help:troubleshooting'),
        Markup.button.callback('🔒 Security', 'help:security')
      ],
      [
        Markup.button.callback('🔙 Back to Main Menu', 'start')
      ]
    ]);
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    } else {
      await ctx.replyWithMarkdown(message, keyboard);
    }
    
    logger.info('Help menu displayed');
  } catch (error) {
    logger.error('Error showing help menu', { error });
    await ctx.reply('Sorry, there was an error displaying the help menu. Please try again later.');
  }
}

/**
 * Handle help-related callbacks
 * @param ctx Context
 */
export async function handleHelpCallback(ctx: any): Promise<void> {
  try {
    // Extract callback data
    const callbackData = ctx.callbackQuery.data;
    const action = callbackData.split(':')[1];
    
    logger.info('Help callback received', { action });
    
    await ctx.answerCbQuery();
    
    // Handle different help topics
    switch (action) {
      case 'commands':
        await showCommandsHelp(ctx);
        break;
      case 'sweep_guide':
        await showSweepGuide(ctx);
        break;
      case 'wallet_guide':
        await showWalletGuide(ctx);
        break;
      case 'faq':
        await showFAQ(ctx);
        break;
      case 'troubleshooting':
        await showTroubleshooting(ctx);
        break;
      case 'security':
        await showSecurity(ctx);
        break;
      case 'menu':
      default:
        await showHelpMenu(ctx);
        break;
    }
    
    logger.info('Help callback completed', { action });
  } catch (error) {
    logger.error('Error handling help callback', { error });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show detailed commands help
 * @param ctx Context
 */
async function showCommandsHelp(ctx: any): Promise<void> {
  try {
    const message = `
📚 *Bot Commands*

Here's a detailed explanation of all available commands:

*/start*
• Initializes the bot and creates your user profile
• Shows welcome message and quick action buttons
• Use this command if you're new or need to restart

*/wallet*
• Manage your Ronin wallets
• Create new wallets or import existing ones
• View wallet addresses and balances
• Set active wallet for sweeping

*/marketplace*
• Browse Axie Infinity marketplace listings
• View latest listings, collections, classes, and top deals
• Add Axies to your sweep list
• Start sweeping Axies directly from collection views

*/balance*
• Check balances of all your wallets
• Shows ETH, AXS, and SLP balances
• Displays total balance across all wallets

*/history*
• View your transaction history
• See details of past sweeps
• Check transaction status
• View purchased Axies

*/settings*
• Configure your preferences
• Set maximum sweep quantity
• Set daily transaction limits
• Toggle notifications

*/help*
• Show this help information
• Access guides and FAQs
• Get troubleshooting assistance
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
    
    logger.info('Commands help displayed');
  } catch (error) {
    logger.error('Error showing commands help', { error });
    await ctx.editMessageText('Sorry, there was an error displaying the commands help. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
  }
}

/**
 * Show sweep guide
 * @param ctx Context
 */
async function showSweepGuide(ctx: any): Promise<void> {
  try {
    const message = `
🧹 *Sweeping Guide*

Sweeping refers to bulk purchasing of Axies from the marketplace. Here's how to use this feature:

*Step 1: Prepare Your Wallet*
• Use /wallet to set up a Ronin wallet
• Ensure you have enough ETH for purchases
• Set one wallet as active (marked with ✅)

*Step 2: Start Sweeping*
• Use /marketplace to browse collections
• Select a collection (Origin, Mystic, etc.)
• View current floor prices and stats

*Step 3: Configure Sweep*
• Choose quantity (2, 5, 10, 20, or custom amount)
• Set maximum price per Axie (optional)
• Review the sweep preview

*Step 4: Execute Sweep*
• Confirm the transaction
• Wait for blockchain confirmation
• View results in transaction history

*Tips for Successful Sweeping:*
• Start with small quantities to test
• Check floor prices before sweeping
• Set reasonable max prices to avoid overpaying
• Monitor your transaction in /history

*Collections Available:*
• Origin Gen 0
• Summer 2022
• Nightmare
• Christmas (Xmas)
• MEO Corp
• Shiny
• Japanese
• Origin
• Mystic
• Regular Axies
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🛒 Open Marketplace', 'marketplace:menu')],
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
    
    logger.info('Sweep guide displayed');
  } catch (error) {
    logger.error('Error showing sweep guide', { error });
    await ctx.editMessageText('Sorry, there was an error displaying the sweep guide. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
  }
}

/**
 * Show wallet guide
 * @param ctx Context
 */
async function showWalletGuide(ctx: any): Promise<void> {
  try {
    const message = `
🔑 *Wallet Management Guide*

This bot allows you to create and manage Ronin wallets for interacting with the Axie Marketplace.

*Creating a New Wallet:*
• Use /wallet and select "Create New"
• A new Ronin wallet will be generated
• IMPORTANT: Save your private key securely!
• The wallet will be saved to your profile

*Importing an Existing Wallet:*
• Use /wallet and select "Import Existing"
• Send your private key or seed phrase
• Your message will be deleted immediately for security
• Name your wallet for easy identification

*Managing Multiple Wallets:*
• You can have multiple wallets in your profile
• Set one as active (marked with ✅) for sweeping
• View all wallets with /wallet command
• Delete wallets you no longer need

*Checking Balances:*
• Use /balance to see all wallet balances
• Shows ETH, AXS, and SLP for each wallet
• Total balance across all wallets is displayed

*Security Notes:*
• Your private keys are encrypted in storage
• Never share your private keys with anyone
• The bot will never ask for your keys outside the import process
• Messages containing keys are deleted automatically
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔑 Manage Wallets Now', 'wallet:setup')],
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
    
    logger.info('Wallet guide displayed');
  } catch (error) {
    logger.error('Error showing wallet guide', { error });
    await ctx.editMessageText('Sorry, there was an error displaying the wallet guide. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
  }
}

/**
 * Show FAQ
 * @param ctx Context
 */
async function showFAQ(ctx: any): Promise<void> {
  try {
    const message = `
❓ *Frequently Asked Questions*

*Q: What is sweeping?*
A: Sweeping is the process of buying multiple Axies in bulk from the marketplace, usually targeting the lowest-priced Axies in a collection.

*Q: How much ETH do I need to sweep?*
A: The amount depends on the collection and quantity. You'll see a preview with the total cost (including gas) before confirming any transaction.

*Q: Is there a limit to how many Axies I can sweep?*
A: Yes, the default limit is 20 Axies per sweep, but you can adjust this in /settings up to the system maximum of 100.

*Q: How are the Axies selected for sweeping?*
A: The bot selects the cheapest available Axies in your chosen collection that match your criteria (if specified).

*Q: What happens if an Axie is sold during my sweep?*
A: The bot handles this gracefully and will continue with the remaining Axies. You'll only pay for successfully purchased Axies.

*Q: Can I cancel a sweep once it's started?*
A: Once confirmed and submitted to the blockchain, a sweep cannot be cancelled. Always review the preview carefully.

*Q: How secure are my wallet keys?*
A: Your private keys are encrypted with industry-standard encryption and never stored in plaintext. Messages containing keys are automatically deleted.

*Q: What are the fees for using this bot?*
A: The bot charges no additional fees beyond the standard Axie Marketplace fees and blockchain gas fees.

*Q: Can I filter Axies by specific traits?*
A: Advanced filtering by traits, parts, and genes is planned for a future update.

*Q: What if I encounter an error during sweeping?*
A: Check the Troubleshooting section for common issues and solutions. If problems persist, try again later or with different parameters.
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔧 Troubleshooting', 'help:troubleshooting')],
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
    
    logger.info('FAQ displayed');
  } catch (error) {
    logger.error('Error showing FAQ', { error });
    await ctx.editMessageText('Sorry, there was an error displaying the FAQ. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
  }
}

/**
 * Show troubleshooting guide
 * @param ctx Context
 */
async function showTroubleshooting(ctx: any): Promise<void> {
  try {
    const message = `
🔧 *Troubleshooting Guide*

Here are solutions to common issues you might encounter:

*Insufficient Balance Errors:*
• Ensure your active wallet has enough ETH for the total cost plus gas
• Remember that gas prices fluctuate based on network congestion
• Try reducing the quantity or maximum price

*Transaction Failures:*
• "Nonce too low" - The transaction was already processed or replaced
• "Gas price too low" - Network congestion, try again with higher gas
• "Execution reverted" - Contract error, try with different parameters

*Wallet Connection Issues:*
• "Invalid private key" - Double-check your private key format
• "Cannot fetch balance" - Network issues, try again later
• "Wallet not found" - The wallet may have been deleted

*Marketplace API Issues:*
• "Failed to fetch collection stats" - API timeout, try again later
• "No Axies found" - No Axies match your criteria, try different parameters
• "API rate limit" - Too many requests, wait a few minutes

*Bot Response Issues:*
• If the bot stops responding, use /start to reset
• If you see "An error occurred", try your request again
• For persistent issues, try restarting your Telegram app

*Transaction Monitoring:*
• If a transaction shows "Pending" for a long time, check the explorer
• Sometimes transactions complete but aren't detected by the bot
• Use /history to manually refresh transaction status

If you continue to experience issues, please try again later as the issue may be temporary.
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('❓ FAQ', 'help:faq')],
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
    
    logger.info('Troubleshooting guide displayed');
  } catch (error) {
    logger.error('Error showing troubleshooting guide', { error });
    await ctx.editMessageText('Sorry, there was an error displaying the troubleshooting guide. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
  }
}

/**
 * Show security information
 * @param ctx Context
 */
async function showSecurity(ctx: any): Promise<void> {
  try {
    const message = `
🔒 *Security Information*

Your security is our priority. Here's how we protect your data and assets:

*Private Key Protection:*
• Private keys are encrypted using AES-256 encryption
• Keys are never stored in plaintext
• Messages containing keys are automatically deleted
• Keys are only decrypted when needed for transactions

*Wallet Security:*
• You maintain full control of your wallets
• The bot never transfers assets without your confirmation
• Transaction limits prevent excessive spending
• Each transaction requires explicit confirmation

*Data Privacy:*
• We only store essential data needed for functionality
• Your Telegram ID is used only for associating with your wallets
• No personal information is collected or shared

*Best Practices:*
• Never share your private keys with anyone
• Use a dedicated wallet for bot operations
• Set reasonable daily limits in /settings
• Review all transaction details before confirming
• Consider using a hardware wallet for large holdings

*Important Warnings:*
• The bot will NEVER ask for your private key outside the import process
• NEVER click on suspicious links claiming to be from this bot
• Always verify transaction details before confirming
• If you suspect any security issues, stop using the bot immediately

Remember: Security is a shared responsibility. Always practice good security hygiene with your crypto assets.
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('⚙️ Adjust Settings', 'settings:menu')],
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
    
    logger.info('Security information displayed');
  } catch (error) {
    logger.error('Error showing security information', { error });
    await ctx.editMessageText('Sorry, there was an error displaying the security information. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Help Menu', 'help:menu')]
        ]
      }
    });
  }
}
