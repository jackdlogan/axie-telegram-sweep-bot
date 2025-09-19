import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';
import SweepService from '../../services/sweepService';
import { AxieCollection } from '../../services/marketplaceService';

// Initialize logger
const logger = new Logger('command:history');

// Initialize sweep service
const sweepService = new SweepService();

// Collection display names for better UI
const collectionNames: Record<string, string> = {
  'origin-gen0': 'Origin Gen 0',
  'summer-2022': 'Summer 2022',
  'nightmare': 'Nightmare',
  'christmas': 'Christmas (Xmas)',
  'meo-corp': 'MEO Corp',
  'shiny': 'Shiny',
  'japanese': 'Japanese',
  'origin': 'Origin',
  'mystic': 'Mystic',
  'regular': 'Regular Axies'
};

// Default page size for pagination
const PAGE_SIZE = 5;

/**
 * Handle the /history command
 * Shows transaction history with detailed views and transaction status
 */
export async function handleHistoryCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('History command received', { userId });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return;
    }
    
    // Show transaction history
    await showTransactionHistory(ctx, user.id, 0);
    
    logger.info('History command completed', { userId });
  } catch (error) {
    logger.error('Error handling history command', { error });
    await ctx.reply('Sorry, there was an error retrieving your transaction history. Please try again later.');
  }
}

/**
 * Show transaction history
 * @param ctx Context
 * @param userId User ID
 * @param page Page number (0-based)
 */
async function showTransactionHistory(ctx: any, userId: number, page: number = 0): Promise<void> {
  try {
    // Show loading message
    if (page === 0 && !ctx.callbackQuery) {
      await ctx.reply('📜 Fetching transaction history... Please wait.');
    } else if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
    
    // Calculate offset
    const offset = page * PAGE_SIZE;
    
    // Get transaction history
    const transactions = await sweepService.getTransactionHistory(
      ctx.dbConnection,
      userId,
      PAGE_SIZE,
      offset
    );
    
    // Get total count for pagination
    const totalCountResult = await ctx.dbConnection('transactions')
      .where({ user_id: userId })
      .count('id as count')
      .first();
    
    const totalCount = parseInt(totalCountResult?.count || '0');
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    
    if (transactions.length === 0 && page === 0) {
      // No transactions found
      const message = `
📜 *Transaction History*

You haven't made any transactions yet.

Start sweeping Axies to see your transaction history here!
      `;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🧹 Start Sweeping', 'sweep:start')]
      ]);
      
      if (ctx.callbackQuery) {
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else {
        await ctx.replyWithMarkdown(message, keyboard);
      }
      
      logger.info('No transactions found', { userId });
      return;
    } else if (transactions.length === 0 && page > 0) {
      // No transactions on this page, go back to first page
      await showTransactionHistory(ctx, userId, 0);
      return;
    }
    
    // Create history message
    let message = `
📜 *Transaction History* (Page ${page + 1}/${totalPages || 1})

${totalCount} total transaction${totalCount !== 1 ? 's' : ''}
    `;
    
    // Format transactions
    transactions.forEach((tx, index) => {
      const date = new Date(tx.createdAt).toLocaleDateString();
      const time = new Date(tx.createdAt).toLocaleTimeString();
      const statusEmoji = tx.status === 'confirmed' ? '✅' : (tx.status === 'pending' ? '⏳' : '❌');
      const collectionName = collectionNames[tx.collection as string] || tx.collection;
      
      message += `\n${index + 1 + offset}. ${statusEmoji} *${collectionName}*\n`;
      message += `   ${tx.axieIds.length} Axies, ${tx.totalAmount.toFixed(4)} RON\n`;
      message += `   ${date} ${time}\n`;
      
      if (tx.status === 'failed' && tx.error) {
        message += `   Error: ${tx.error.substring(0, 50)}${tx.error.length > 50 ? '...' : ''}\n`;
      }
    });
    
    // Create transaction buttons
    const txButtons = [];
    
    transactions.forEach((tx, index) => {
      txButtons.push([
        Markup.button.callback(
          `View #${index + 1 + offset}: ${collectionNames[tx.collection as string] || tx.collection}`,
          `sweep:view_transaction:${tx.txHash}`
        )
      ]);
    });
    
    // Create pagination buttons
    const paginationButtons = [];
    
    if (totalPages > 1) {
      // Previous page button
      if (page > 0) {
        paginationButtons.push(
          Markup.button.callback('⬅️ Previous', `history:page:${page - 1}`)
        );
      }
      
      // Page indicator
      paginationButtons.push(
        Markup.button.callback(`${page + 1}/${totalPages}`, 'history:noop')
      );
      
      // Next page button
      if (page < totalPages - 1) {
        paginationButtons.push(
          Markup.button.callback('Next ➡️', `history:page:${page + 1}`)
        );
      }
      
      txButtons.push(paginationButtons);
    }
    
    // Add refresh and back buttons
    txButtons.push([
      Markup.button.callback('🔄 Refresh', `history:page:${page}`),
      Markup.button.callback('🔙 Back to Menu', 'sweep:start')
    ]);
    
    // Send or edit message
    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: txButtons
        }
      });
    } else {
      await ctx.replyWithMarkdown(message, {
        reply_markup: {
          inline_keyboard: txButtons
        }
      });
    }
    
    logger.info('Transaction history displayed', { userId, page, transactionCount: transactions.length });
    
    // Set up callback handler for pagination
    setupHistoryCallbacks(ctx);
  } catch (error) {
    logger.error('Error showing transaction history', { error, userId, page });
    
    const errorMessage = 'Sorry, there was an error retrieving your transaction history. Please try again later.';
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(errorMessage, {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'history:page:0')],
            [Markup.button.callback('🔙 Back to Menu', 'sweep:start')]
          ]
        }
      });
    } else {
      await ctx.reply(errorMessage, {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'history:page:0')],
            [Markup.button.callback('🔙 Back to Menu', 'sweep:start')]
          ]
        }
      });
    }
  }
}

/**
 * View transaction details
 * @param ctx Context
 * @param userId User ID
 * @param txHash Transaction hash
 */
async function viewTransactionDetails(ctx: any, userId: number, txHash: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Show loading message
    await ctx.editMessageText('📜 Fetching transaction details... Please wait.');
    
    try {
      // Generate sweep report
      const report = await sweepService.generateSweepReport(ctx.dbConnection, txHash, userId);
      
      // Create buttons
      const buttons = [
        [
          Markup.button.url('View on Explorer', `https://explorer.roninchain.com/tx/${txHash}`),
          Markup.button.callback('🔄 Refresh', `history:view:${txHash}`)
        ],
        [
          Markup.button.callback('🔙 Back to History', 'history:page:0'),
          Markup.button.callback('🔙 Main Menu', 'sweep:start')
        ]
      ];
      
      // Edit message with report
      await ctx.editMessageText(report, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buttons
        },
        disable_web_page_preview: true
      });
      
      logger.info('Transaction details displayed', { userId, txHash });
    } catch (error) {
      logger.error('Error fetching transaction details', { error, userId, txHash });
      await ctx.editMessageText('Sorry, there was an error fetching the transaction details. Please try again later.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', `history:view:${txHash}`)],
            [Markup.button.callback('🔙 Back to History', 'history:page:0')]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error viewing transaction details', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Set up callback handlers for history pagination and viewing
 * @param ctx Context
 */
function setupHistoryCallbacks(ctx: any): void {
  // This function sets up the action handlers for history-related callbacks
  // The actual implementation is in the main bot file's callback handling
  
  // Here we're just documenting the expected callback patterns:
  // history:page:{pageNumber} - Show transaction history page
  // history:view:{txHash} - View transaction details
  // history:noop - No operation (used for page indicator button)
}

/**
 * Handle history-related callbacks
 * @param ctx Context
 */
export async function handleHistoryCallback(ctx: any): Promise<void> {
  try {
    // Extract callback data and user information
    const callbackData = ctx.callbackQuery.data;
    const action = callbackData.split(':')[1];
    const value = callbackData.split(':')[2];
    const userId = ctx.from?.id;
    
    logger.info('History callback received', { userId, action, value });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.answerCallbackQuery('Please start the bot with /start first.');
      return;
    }
    
    // Handle different history actions
    switch (action) {
      case 'page':
        await showTransactionHistory(ctx, user.id, parseInt(value));
        break;
      case 'view':
        await viewTransactionDetails(ctx, user.id, value);
        break;
      case 'noop':
        await ctx.answerCallbackQuery('Current page indicator');
        break;
      default:
        await ctx.answerCallbackQuery('Unknown action');
        break;
    }
    
    logger.info('History callback completed', { userId, action });
  } catch (error) {
    logger.error('Error handling history callback', { error });
    await ctx.answerCallbackQuery('An error occurred. Please try again.');
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}
