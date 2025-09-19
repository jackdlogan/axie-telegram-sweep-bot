import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';
import WalletService from '../../services/walletService';
import config from '../../config';

// Initialize logger
const logger = new Logger('command:wallet');

// Initialize wallet service
const walletService = new WalletService();

// Interface for wallet display data
interface WalletDisplay {
  id: number;
  name: string;
  address: string;
  shortAddress: string;
  isActive: boolean;
}

/**
 * Handle the /wallet command
 * Shows wallet management options
 */
export async function handleWalletCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('Wallet command received', { userId });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return;
    }
    
    // Get user's wallets
    const wallets = await walletService.getUserWallets(ctx.dbConnection, user.id);
    
    // Create wallet menu message
    let message = '🔑 *Wallet Management*\n\n';
    
    if (wallets.length > 0) {
      message += `You have ${wallets.length} wallet(s):\n\n`;
      
      // List wallets
      wallets.forEach((wallet, index) => {
        const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
        message += `${index + 1}. ${wallet.name || 'Wallet'} (${shortAddress}) ${wallet.isActive ? '✅' : ''}\n`;
      });
      
      message += '\nWhat would you like to do?';
    } else {
      message += 'You don\'t have any wallets yet. Would you like to create a new wallet or import an existing one?';
    }
    
    // Create inline keyboard based on wallet count
    let keyboard;
    if (wallets.length > 0) {
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔍 View Wallets', 'wallet:list'),
          Markup.button.callback('💰 Check Balance', 'wallet:balance')
        ],
        [
          Markup.button.callback('🆕 Create New', 'wallet:create'),
          Markup.button.callback('📥 Import Existing', 'wallet:import')
        ],
        [
          Markup.button.callback('🗑️ Delete Wallet', 'wallet:delete'),
          Markup.button.callback('✏️ Rename Wallet', 'wallet:rename')
        ]
      ]);
    } else {
      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🆕 Create New Wallet', 'wallet:create'),
          Markup.button.callback('📥 Import Existing Wallet', 'wallet:import')
        ]
      ]);
    }
    
    // Send wallet menu
    await ctx.replyWithMarkdown(message, keyboard);
    
    logger.info('Wallet command completed', { userId });
  } catch (error) {
    logger.error('Error handling wallet command', { error });
    await ctx.reply('Sorry, there was an error accessing your wallets. Please try again later.');
  }
}

/**
 * Handle wallet-related callbacks
 * @param ctx Context
 */
export async function handleWalletCallback(ctx: any): Promise<void> {
  try {
    // Extract callback data and user information
    const callbackData = ctx.callbackQuery.data;
    const action = callbackData.split(':')[1];
    const userId = ctx.from?.id;
    
    logger.info('Wallet callback received', { userId, action });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.answerCallbackQuery('Please start the bot with /start first.');
      return;
    }
    
    // Handle different wallet actions
    switch (action) {
      case 'create':
        await handleCreateWallet(ctx, user.id);
        break;
      case 'import':
        await handleImportWallet(ctx, user.id);
        break;
      case 'list':
        await handleListWallets(ctx, user.id);
        break;
      case 'balance':
        await handleCheckBalance(ctx, user.id);
        break;
      case 'delete':
        await handleDeleteWallet(ctx, user.id);
        break;
      case 'rename':
        await handleRenameWallet(ctx, user.id);
        break;
      case 'select':
        await handleSelectWallet(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'confirm_delete':
        await handleConfirmDelete(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'setup':
        // Redirect to wallet command
        await handleWalletCommand(ctx);
        break;
      default:
        await ctx.answerCallbackQuery('Unknown action');
        break;
    }
    
    logger.info('Wallet callback completed', { userId, action });
  } catch (error) {
    logger.error('Error handling wallet callback', { error });
    await ctx.answerCallbackQuery('An error occurred. Please try again.');
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Handle wallet creation
 * @param ctx Context
 * @param userId User ID
 */
async function handleCreateWallet(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery('Creating new wallet...');
    
    // Generate new wallet
    const wallet = walletService.generateWallet();
    
    // Default wallet name
    const walletName = `Wallet ${wallet.address.substring(0, 6)}`;
    
    // Save wallet to database
    await walletService.saveWallet(ctx.dbConnection, userId, wallet, walletName);
    
    // Show success message with wallet information
    const message = `
🎉 *New Wallet Created Successfully!*

*Address:* \`${wallet.address}\`
*Private Key:* \`${wallet.privateKey}\`

⚠️ *IMPORTANT: Save your private key securely!* ⚠️
This is the only time your private key will be shown. Store it in a safe place. Anyone with this key can access your funds.

Your wallet has been saved and is ready to use.
    `;
    
    await ctx.replyWithMarkdown(message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Check Balance', callback_data: 'wallet:balance' }],
          [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:list' }]
        ]
      }
    });
    
    // Delete the message with private key after 60 seconds for security
    setTimeout(async () => {
      try {
        await ctx.deleteMessage();
        await ctx.reply('🔒 For security, the message containing your private key has been deleted.');
      } catch (error) {
        logger.warn('Could not delete message with private key', { error });
      }
    }, 60000);
    
    logger.info('New wallet created', { userId, address: wallet.address });
  } catch (error) {
    logger.error('Error creating wallet', { error, userId });
    await ctx.reply('Sorry, there was an error creating your wallet. Please try again later.');
  }
}

/**
 * Handle wallet import
 * @param ctx Context
 * @param userId User ID
 */
async function handleImportWallet(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Set session state for import
    ctx.session.walletAction = 'import';
    
    const message = `
📥 *Import Existing Wallet*

Please send me your private key or seed phrase.

⚠️ *SECURITY WARNING* ⚠️
For your security:
1. This message will be deleted immediately
2. Your key will be encrypted in the database
3. Never share your private key with anyone else

*Send your private key or seed phrase now:*
    `;
    
    await ctx.replyWithMarkdown(message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'cancel' }]
        ]
      }
    });
    
    logger.info('Wallet import initiated', { userId });
  } catch (error) {
    logger.error('Error initiating wallet import', { error, userId });
    await ctx.reply('Sorry, there was an error preparing to import your wallet. Please try again later.');
  }
}

/**
 * Handle wallet listing
 * @param ctx Context
 * @param userId User ID
 */
async function handleListWallets(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get user's wallets
    const wallets = await walletService.getUserWallets(ctx.dbConnection, userId);
    
    if (wallets.length === 0) {
      await ctx.editMessageText('You don\'t have any wallets yet.', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🆕 Create New Wallet', callback_data: 'wallet:create' },
              { text: '📥 Import Existing Wallet', callback_data: 'wallet:import' }
            ]
          ]
        }
      });
      return;
    }
    
    // Format wallets for display
    const walletDisplays: WalletDisplay[] = wallets.map(wallet => ({
      id: wallet.id!,
      name: wallet.name || `Wallet ${wallet.address.substring(0, 6)}`,
      address: wallet.address,
      shortAddress: `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`,
      isActive: wallet.isActive
    }));
    
    // Create message
    let message = '🔑 *Your Wallets*\n\n';
    
    walletDisplays.forEach((wallet, index) => {
      message += `${index + 1}. ${wallet.name} ${wallet.isActive ? '✅' : ''}\n`;
      message += `   Address: \`${wallet.address}\`\n\n`;
    });
    
    // Create wallet selection buttons (up to 5 per row)
    const walletButtons = [];
    const buttonsPerRow = 3;
    
    for (let i = 0; i < walletDisplays.length; i += buttonsPerRow) {
      const row = [];
      for (let j = 0; j < buttonsPerRow && i + j < walletDisplays.length; j++) {
        const wallet = walletDisplays[i + j];
        row.push({
          text: `${i + j + 1}${wallet.isActive ? ' ✅' : ''}`,
          callback_data: `wallet:select:${wallet.id}`
        });
      }
      walletButtons.push(row);
    }
    
    // Add action buttons
    walletButtons.push([
      { text: '🆕 Create New', callback_data: 'wallet:create' },
      { text: '📥 Import', callback_data: 'wallet:import' },
      { text: '💰 Balance', callback_data: 'wallet:balance' }
    ]);
    
    // Add back button
    walletButtons.push([
      { text: '🔙 Back to Menu', callback_data: 'wallet:setup' }
    ]);
    
    // Edit message with wallet list
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: walletButtons
      }
    });
    
    logger.info('Wallet list displayed', { userId, walletCount: wallets.length });
  } catch (error) {
    logger.error('Error listing wallets', { error, userId });
    await ctx.reply('Sorry, there was an error listing your wallets. Please try again later.');
  }
}

/**
 * Handle wallet balance check
 * @param ctx Context
 * @param userId User ID
 */
async function handleCheckBalance(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery('Checking balances...');
    
    // Get user's wallets
    const wallets = await walletService.getUserWallets(ctx.dbConnection, userId);
    
    if (wallets.length === 0) {
      await ctx.editMessageText('You don\'t have any wallets yet.', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🆕 Create New Wallet', callback_data: 'wallet:create' },
              { text: '📥 Import Existing Wallet', callback_data: 'wallet:import' }
            ]
          ]
        }
      });
      return;
    }
    
    // Show loading message
    await ctx.editMessageText('💰 Fetching wallet balances... Please wait.');
    
    // Format wallets for display and fetch balances
    let message = '💰 *Wallet Balances*\n\n';
    
    // Fetch balances for each wallet
    for (const wallet of wallets) {
      try {
        const balances = await walletService.getTokenBalances(wallet.address);
        const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
        const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
        
        message += `*${name}* ${wallet.isActive ? '✅' : ''}\n`;
        message += `Address: \`${shortAddress}\`\n`;
        message += `RON: ${parseFloat(balances.ron).toFixed(4)}\n`;
        message += `AXS: ${parseFloat(balances.axs).toFixed(4)}\n`;
        message += `SLP: ${parseFloat(balances.slp).toFixed(2)}\n\n`;
      } catch (error) {
        logger.error('Error fetching balance for wallet', { error, address: wallet.address });
        
        const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
        const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
        
        message += `*${name}* ${wallet.isActive ? '✅' : ''}\n`;
        message += `Address: \`${shortAddress}\`\n`;
        message += `Error fetching balances\n\n`;
      }
    }
    
    // Edit message with balance information
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Refresh', callback_data: 'wallet:balance' },
            { text: '🔙 Back to Wallets', callback_data: 'wallet:list' }
          ]
        ]
      }
    });
    
    logger.info('Wallet balances displayed', { userId, walletCount: wallets.length });
  } catch (error) {
    logger.error('Error checking wallet balances', { error, userId });
    await ctx.reply('Sorry, there was an error checking your wallet balances. Please try again later.');
  }
}

/**
 * Handle wallet deletion
 * @param ctx Context
 * @param userId User ID
 */
async function handleDeleteWallet(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get user's wallets
    const wallets = await walletService.getUserWallets(ctx.dbConnection, userId);
    
    if (wallets.length === 0) {
      await ctx.editMessageText('You don\'t have any wallets to delete.', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🆕 Create New Wallet', callback_data: 'wallet:create' },
              { text: '🔙 Back to Menu', callback_data: 'wallet:setup' }
            ]
          ]
        }
      });
      return;
    }
    
    // Create message
    let message = '🗑️ *Delete Wallet*\n\n';
    message += 'Select a wallet to delete:\n\n';
    
    // Format wallets for display
    wallets.forEach((wallet, index) => {
      const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
      const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
      message += `${index + 1}. ${name} (${shortAddress}) ${wallet.isActive ? '✅' : ''}\n`;
    });
    
    // Create wallet selection buttons
    const walletButtons = [];
    const buttonsPerRow = 3;
    
    for (let i = 0; i < wallets.length; i += buttonsPerRow) {
      const row = [];
      for (let j = 0; j < buttonsPerRow && i + j < wallets.length; j++) {
        const wallet = wallets[i + j];
        row.push({
          text: `${i + j + 1}${wallet.isActive ? ' ✅' : ''}`,
          callback_data: `wallet:confirm_delete:${wallet.id}`
        });
      }
      walletButtons.push(row);
    }
    
    // Add cancel button
    walletButtons.push([
      { text: '❌ Cancel', callback_data: 'wallet:list' }
    ]);
    
    // Edit message with wallet selection
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: walletButtons
      }
    });
    
    logger.info('Delete wallet selection displayed', { userId });
  } catch (error) {
    logger.error('Error preparing wallet deletion', { error, userId });
    await ctx.reply('Sorry, there was an error preparing to delete your wallet. Please try again later.');
  }
}

/**
 * Handle wallet rename
 * @param ctx Context
 * @param userId User ID
 */
async function handleRenameWallet(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get user's wallets
    const wallets = await walletService.getUserWallets(ctx.dbConnection, userId);
    
    if (wallets.length === 0) {
      await ctx.editMessageText('You don\'t have any wallets to rename.', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🆕 Create New Wallet', callback_data: 'wallet:create' },
              { text: '🔙 Back to Menu', callback_data: 'wallet:setup' }
            ]
          ]
        }
      });
      return;
    }
    
    // Create message
    let message = '✏️ *Rename Wallet*\n\n';
    message += 'Select a wallet to rename:\n\n';
    
    // Format wallets for display
    wallets.forEach((wallet, index) => {
      const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
      const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
      message += `${index + 1}. ${name} (${shortAddress}) ${wallet.isActive ? '✅' : ''}\n`;
    });
    
    // Create wallet selection buttons
    const walletButtons = [];
    const buttonsPerRow = 3;
    
    for (let i = 0; i < wallets.length; i += buttonsPerRow) {
      const row = [];
      for (let j = 0; j < buttonsPerRow && i + j < wallets.length; j++) {
        const wallet = wallets[i + j];
        row.push({
          text: `${i + j + 1}${wallet.isActive ? ' ✅' : ''}`,
          callback_data: `wallet:rename:${wallet.id}`
        });
      }
      walletButtons.push(row);
    }
    
    // Add cancel button
    walletButtons.push([
      { text: '❌ Cancel', callback_data: 'wallet:list' }
    ]);
    
    // Edit message with wallet selection
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: walletButtons
      }
    });
    
    // Set session state for rename
    ctx.session.walletAction = 'rename';
    
    logger.info('Rename wallet selection displayed', { userId });
  } catch (error) {
    logger.error('Error preparing wallet rename', { error, userId });
    await ctx.reply('Sorry, there was an error preparing to rename your wallet. Please try again later.');
  }
}

/**
 * Handle wallet selection
 * @param ctx Context
 * @param userId User ID
 * @param walletId Wallet ID
 */
async function handleSelectWallet(ctx: any, userId: number, walletId: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const walletIdNum = parseInt(walletId);
    
    // Get wallet details
    const wallet = await walletService.getWalletById(ctx.dbConnection, walletIdNum, userId);
    
    if (!wallet) {
      await ctx.reply('Wallet not found.');
      return;
    }
    
    // Set wallet as active
    await ctx.dbConnection('wallets')
      .where({ user_id: userId })
      .update({ is_active: false });
    
    await ctx.dbConnection('wallets')
      .where({ id: walletIdNum, user_id: userId })
      .update({ is_active: true });
    
    // Get updated wallet list
    await handleListWallets(ctx, userId);
    
    logger.info('Wallet selected as active', { userId, walletId: walletIdNum });
  } catch (error) {
    logger.error('Error selecting wallet', { error, userId, walletId });
    await ctx.reply('Sorry, there was an error selecting your wallet. Please try again later.');
  }
}

/**
 * Handle wallet deletion confirmation
 * @param ctx Context
 * @param userId User ID
 * @param walletId Wallet ID
 */
async function handleConfirmDelete(ctx: any, userId: number, walletId: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const walletIdNum = parseInt(walletId);
    
    // Get wallet details
    const wallet = await walletService.getWalletById(ctx.dbConnection, walletIdNum, userId);
    
    if (!wallet) {
      await ctx.reply('Wallet not found.');
      return;
    }
    
    const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
    const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
    
    // Create confirmation message
    const message = `
⚠️ *Confirm Wallet Deletion* ⚠️

You are about to delete the following wallet:

*Name:* ${name}
*Address:* \`${shortAddress}\`

This action cannot be undone. Are you sure?
    `;
    
    // Create confirmation buttons
    const keyboard = Markup.inlineKeyboard([
      [
        { text: '✅ Yes, Delete', callback_data: `wallet:delete_confirmed:${walletId}` },
        { text: '❌ No, Cancel', callback_data: 'wallet:list' }
      ]
    ]);
    
    // Edit message with confirmation
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
    // Set up listener for delete_confirmed action
    ctx.scene.enter('wallet_delete_scene', { walletId: walletIdNum });
    
    logger.info('Wallet deletion confirmation displayed', { userId, walletId: walletIdNum });
  } catch (error) {
    logger.error('Error confirming wallet deletion', { error, userId, walletId });
    await ctx.reply('Sorry, there was an error preparing to delete your wallet. Please try again later.');
  }
}

// Add a handler for the wallet_delete_scene
// This would be defined in a separate scenes file, but we'll include a stub here
// for completeness of the wallet.ts file
export const walletDeleteScene = {
  // Scene for handling wallet deletion confirmation
  async enter(ctx: any) {
    // Store wallet ID in scene state
    ctx.scene.state.walletId = ctx.scene.state.walletId;
  },
  
  // Handle delete_confirmed action
  async on(ctx: any, next: any) {
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('wallet:delete_confirmed:')) {
      const walletId = parseInt(ctx.callbackQuery.data.split(':')[2]);
      const userId = ctx.from.id;
      
      try {
        // Get user ID from database
        const user = await ctx.dbConnection('users')
          .where({ telegram_id: userId })
          .first('id');
        
        if (!user) {
          await ctx.answerCallbackQuery('User not found.');
          return ctx.scene.leave();
        }
        
        // Delete wallet
        await walletService.deleteWallet(ctx.dbConnection, walletId, user.id);
        
        await ctx.answerCallbackQuery('Wallet deleted successfully!');
        await ctx.editMessageText('✅ Wallet has been deleted successfully.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back to Wallets', callback_data: 'wallet:list' }]
            ]
          }
        });
        
        logger.info('Wallet deleted', { userId, walletId });
      } catch (error) {
        logger.error('Error deleting wallet', { error, userId, walletId });
        await ctx.answerCallbackQuery('Error deleting wallet.');
        await ctx.reply('Sorry, there was an error deleting your wallet. Please try again later.');
      }
      
      return ctx.scene.leave();
    }
    
    return next();
  }
};
