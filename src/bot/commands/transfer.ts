// @ts-nocheck
import { Markup } from 'telegraf';
import Logger from '../../utils/logger';
import WalletService from '../../services/walletService';
import TokenService from '../../services/tokenService';
import MarketplaceService, { AxieCollection } from '../../services/marketplaceService';
import SafeBatchTransferContract from '../../contracts/safeBatchTransfer';
import config from '../../config';
import { ethers } from 'ethers';
import sheetsService from '../../services/sheetsService';

// Initialize services
const logger = new Logger('command:transfer');
const walletService = new WalletService();
const tokenService = new TokenService();
const marketplaceService = new MarketplaceService();
const safeBatchTransferContract = new SafeBatchTransferContract();

// Session state for transfer
interface TransferState {
  collection?: AxieCollection | 'all';
  axieIds?: string[];
  recipientAddress?: string;
  step: 'select_collection' | 'enter_address' | 'confirm' | 'complete';
}

/**
 * Handle the /transfer command
 * Start the Axie transfer process
 */
export async function handleTransferCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('Transfer command received', { userId });
    
    // Check if user exists in database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return;
    }
    
    // Check if user has a wallet
    const wallet = await ctx.dbConnection('wallets')
      .where({ user_id: user.id, is_active: true })
      .first('id', 'address', 'name');
    
    if (!wallet) {
      await ctx.reply('You need to set up a wallet first. Use /wallet to get started.');
      return;
    }
    
    // Initialize transfer state
    ctx.session.transferState = {
      step: 'select_collection'
    };
    
    // Show collection selection
    await showCollectionSelection(ctx, wallet.address);
    
    logger.info('Transfer command completed', { userId });
  } catch (error) {
    logger.error('Error handling transfer command', { error });
    await ctx.reply('Sorry, there was an error starting the transfer process. Please try again later.');
  }
}

/**
 * Handle transfer-related callbacks
 * @param ctx Context
 */
export async function handleTransferCallback(ctx: any): Promise<void> {
  try {
    // Extract callback data and user information
    const callbackData = ctx.callbackQuery.data;
    const parts = callbackData.split(':');
    const action = parts[1];
    const userId = ctx.from?.id;
    
    logger.info('Transfer callback received', { userId, action });
    
    // Get user from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.answerCbQuery('Please start the bot with /start first.');
      return;
    }
    
    // Get active wallet
    const wallet = await ctx.dbConnection('wallets')
      .where({ user_id: user.id, is_active: true })
      .first('id', 'address', 'name', 'encrypted_private_key');
    
    if (!wallet) {
      await ctx.answerCbQuery('You need to set up a wallet first.');
      await ctx.editMessageText('You need to set up a wallet first. Use /wallet to get started.');
      return;
    }
    
    // Initialize transfer state if not exists
    if (!ctx.session.transferState) {
      ctx.session.transferState = {
        step: 'select_collection'
      };
    }
    
    // Handle different actions
    switch (action) {
      case 'start':
        // Format: transfer:start
        // Initialize transfer state and show collection selection
        ctx.session.transferState = {
          step: 'select_collection'
        };
        await showCollectionSelection(ctx, wallet.address);
        break;
      case 'collection':
        // Format: transfer:collection:{collection}
        const collection = parts[2];
        await handleCollectionSelection(ctx, user.id, wallet, collection);
        break;
      case 'confirm':
        // Format: transfer:confirm
        await handleTransferConfirmation(ctx, user.id, wallet);
        break;
      case 'execute':
        // Format: transfer:execute
        await executeTransfer(ctx, user.id, wallet);
        break;
      case 'cancel':
        // Format: transfer:cancel
        await handleCancelTransfer(ctx);
        break;
      case 'back':
        // Format: transfer:back:{step}
        const step = parts[2];
        await handleBackNavigation(ctx, wallet, step);
        break;
      default:
        await ctx.answerCbQuery('Unknown action');
        break;
    }
    
    logger.info('Transfer callback completed', { userId, action });
  } catch (error) {
    logger.error('Error handling transfer callback', { error });
    await ctx.answerCbQuery('An error occurred. Please try again.');
    await ctx.editMessageText('Sorry, there was an error processing your request. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Home', callback_data: 'start:menu' }]
        ]
      }
    });
  }
}

/**
 * Process text messages for transfer
 * @param ctx Context
 * @returns Whether the message was processed
 */
export async function processTransferMessage(ctx: any): Promise<boolean> {
  // Check if we're expecting a transfer-related message
  if (!ctx.session.transferState) {
    return false;
  }
  
  const state = ctx.session.transferState;
  const userId = ctx.from?.id;
  
  try {
    // Get user from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return true;
    }
    
    // Get active wallet
    const wallet = await ctx.dbConnection('wallets')
      .where({ user_id: user.id, is_active: true })
      .first('id', 'address', 'name');
    
    if (!wallet) {
      await ctx.reply('You need to set up a wallet first. Use /wallet to get started.');
      return true;
    }
    
    // Handle different steps
    switch (state.step) {
      case 'enter_address':
        // Process recipient address
        const address = ctx.message.text.trim();
        await handleRecipientAddress(ctx, wallet, address);
        return true;
      default:
        return false;
    }
  } catch (error) {
    logger.error('Error processing transfer message', { error, userId, state });
    await ctx.reply('Sorry, there was an error processing your input. Please try again.');
    return true;
  }
}

/**
 * Show collection selection
 * @param ctx Context
 * @param walletAddress Wallet address
 */
async function showCollectionSelection(ctx: any, walletAddress: string): Promise<void> {
  try {
    // Show loading message
    await ctx.reply('Loading your Axies...');
    // ------------------------------------------------------------------
    // Normalize address for on-chain calls:
    //   • Axie contract uses standard 0x addresses.
    //   • Users (and DB) often store / display addresses in ronin: format.
    // ------------------------------------------------------------------
    const ethAddress = walletAddress.startsWith('ronin:')
      ? '0x' + walletAddress.substring(6)
      : walletAddress;
    
    // Get user's Axies
    const axiesByCollection = await getAxiesByCollection(walletAddress);
    
    // Create message
    let message = '🔄 *Transfer Axies*\n\n';
    message += 'Select which collection you want to transfer:\n\n';
    
    // Add collection counts
    for (const [collection, axieIds] of Object.entries(axiesByCollection)) {
      if (axieIds.length > 0) {
        const emoji = getCollectionEmoji(collection);
        message += `${emoji} *${formatCollectionName(collection)}*: ${axieIds.length} Axies\n`;
      }
    }
    
    // Calculate total
    const totalAxies = Object.values(axiesByCollection)
      .reduce((total, axieIds) => total + axieIds.length, 0);
    
    message += `\n🔢 *Total Axies*: ${totalAxies}\n\n`;
    message += 'Please select a collection to transfer, or transfer all Axies:';
    
    // Create collection buttons
    const keyboard = [];
    
    // Add buttons for collections with Axies
    for (const [collection, axieIds] of Object.entries(axiesByCollection)) {
      if (axieIds.length > 0) {
        const emoji = getCollectionEmoji(collection);
        keyboard.push([
          Markup.button.callback(
            `${emoji} ${formatCollectionName(collection)} (${axieIds.length})`,
            `transfer:collection:${collection}`
          )
        ]);
      }
    }
    
    // Add "All Axies" button if there are Axies
    if (totalAxies > 0) {
      keyboard.push([
        Markup.button.callback(`🔢 All Axies (${totalAxies})`, 'transfer:collection:all')
      ]);
    }
    
    // Add back button
    keyboard.push([
      Markup.button.callback('🔙 Back to Home', 'start:menu')
    ]);
    
    // Send message with buttons
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    logger.error('Error showing collection selection', { error, walletAddress });
    await ctx.reply('Sorry, there was an error loading your Axies. Please try again later.');
  }
}

/**
 * Handle collection selection
 * @param ctx Context
 * @param userId User ID
 * @param wallet Wallet
 * @param collection Collection
 */
async function handleCollectionSelection(
  ctx: any,
  userId: number,
  wallet: any,
  collection: string
): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Get Axies for the selected collection
    const axiesByCollection = await getAxiesByCollection(wallet.address);
    let selectedAxieIds: string[] = [];
    
    if (collection === 'all') {
      // Combine all Axies
      selectedAxieIds = Object.values(axiesByCollection)
        .reduce((all, axieIds) => [...all, ...axieIds], []);
    } else {
      // Get Axies for specific collection
      selectedAxieIds = axiesByCollection[collection] || [];
    }
    
    // Check if there are Axies to transfer
    if (selectedAxieIds.length === 0) {
      await ctx.editMessageText('No Axies found in this collection. Please select another collection.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Collections', callback_data: 'transfer:back:select_collection' }]
          ]
        }
      });
      return;
    }
    
    // Update session state
    ctx.session.transferState = {
      ...ctx.session.transferState,
      collection: collection === 'all' ? 'all' : collection as AxieCollection,
      axieIds: selectedAxieIds,
      step: 'enter_address'
    };
    
    // Show address input prompt
    const message = `
🔄 *Transfer Axies*

You've selected to transfer ${selectedAxieIds.length} Axies ${collection === 'all' ? 'from all collections' : `from the ${formatCollectionName(collection)} collection`}.

Please enter the recipient's Ronin wallet address:
• Format: ronin:... or 0x...
• Double-check the address to avoid loss of assets!
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Collections', callback_data: 'transfer:back:select_collection' }],
          [{ text: '❌ Cancel Transfer', callback_data: 'transfer:cancel' }]
        ]
      }
    });
    
    logger.info('Collection selected for transfer', { userId, collection, axieCount: selectedAxieIds.length });
  } catch (error) {
    logger.error('Error handling collection selection', { error, userId, collection });
    await ctx.editMessageText('Sorry, there was an error processing your selection. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Home', callback_data: 'start:menu' }]
        ]
      }
    });
  }
}

/**
 * Handle recipient address input
 * @param ctx Context
 * @param wallet Wallet
 * @param address Recipient address
 */
async function handleRecipientAddress(ctx: any, wallet: any, address: string): Promise<void> {
  try {
    // Validate and normalize address
    const validatedAddress = validateAndNormalizeAddress(address);
    
    if (!validatedAddress) {
      await ctx.reply('Invalid address format. Please enter a valid Ronin address (ronin:... or 0x...).');
      return;
    }
    
    // Check if trying to send to self
    if (validatedAddress.toLowerCase() === wallet.address.toLowerCase()) {
      await ctx.reply('You cannot transfer Axies to your own wallet. Please enter a different address.');
      return;
    }
    
    // Update session state
    ctx.session.transferState = {
      ...ctx.session.transferState,
      recipientAddress: validatedAddress,
      step: 'confirm'
    };
    
    // Show confirmation
    await showTransferConfirmation(ctx, wallet.address, ctx.session.transferState);
    
    logger.info('Recipient address entered', { 
      walletAddress: wallet.address,
      recipientAddress: validatedAddress,
      axieCount: ctx.session.transferState.axieIds?.length
    });
  } catch (error) {
    logger.error('Error handling recipient address', { error, address });
    await ctx.reply('Sorry, there was an error processing the address. Please try again.');
  }
}

/**
 * Show transfer confirmation
 * @param ctx Context
 * @param walletAddress Wallet address
 * @param state Transfer state
 */
async function showTransferConfirmation(
  ctx: any,
  walletAddress: string,
  state: TransferState
): Promise<void> {
  try {
    const { axieIds, recipientAddress, collection } = state;
    
    if (!axieIds || !recipientAddress) {
      throw new Error('Missing required transfer information');
    }
    
    // Simple HTML escape helper
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Get Axie details for display
    const axieDetails = await getAxieDetailsForDisplay(axieIds);
    
    // Check if approval is needed
    const isApproved = await safeBatchTransferContract.isApprovedForAll(walletAddress);
    
    // --------------------------------------------------------------
    // Build confirmation message using HTML to avoid Markdown issues
    // --------------------------------------------------------------
    let message = '🔄 <b>Transfer Confirmation</b>\n\n';
    message += `You are about to transfer ${axieIds.length} Axies to:\n`;
    message += `<code>${esc(formatAddress(recipientAddress))}</code>\n\n`;
    
    // Add collection info
    if (collection && collection !== 'all') {
      const emoji = getCollectionEmoji(collection);
      message += `Collection: ${emoji} ${esc(formatCollectionName(collection))}\n\n`;
    }
    
    // Add Axie details
    message += '<b>Axies to transfer:</b>\n';
    
    // Show first 5 Axies with details
    const displayLimit = 5;
    const displayAxies = axieDetails.slice(0, displayLimit);
    
    for (const axie of displayAxies) {
      message += `• #${axie.id} - ${esc(axie.name || `Axie #${axie.id}`)} (${esc(
        axie.class
      )})\n`;
    }
    
    // If there are more Axies, show count
    if (axieIds.length > displayLimit) {
      message += `• ... and ${axieIds.length - displayLimit} more Axies\n`;
    }
    
    // Add approval status
    message += '\n<b>Contract Approval:</b>\n';
    if (isApproved) {
      message += '✅ Transfer contract is already approved\n';
    } else {
      message += '⚠️ You will need to approve the transfer contract first\n';
    }
    
    // Add warning
    message +=
      '\n⚠️ <b>WARNING</b>: This action cannot be undone! Please verify the recipient address carefully.\n';
    message += '\nDo you want to proceed with this transfer?';
    
    // Create confirmation buttons
    const keyboard = [
      [
        Markup.button.callback('✅ Confirm Transfer', 'transfer:confirm'),
        Markup.button.callback('❌ Cancel', 'transfer:cancel')
      ],
      [
        Markup.button.callback('🔙 Change Address', 'transfer:back:enter_address')
      ]
    ];
    
    // Send confirmation message
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    logger.error('Error showing transfer confirmation', { error, walletAddress, state });
    await ctx.reply('Sorry, there was an error preparing the transfer confirmation. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Home', callback_data: 'start:menu' }]
        ]
      }
    });
  }
}

/**
 * Handle transfer confirmation
 * @param ctx Context
 * @param userId User ID
 * @param wallet Wallet
 */
async function handleTransferConfirmation(ctx: any, userId: number, wallet: any): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    const state = ctx.session.transferState;
    
    if (!state || !state.axieIds || !state.recipientAddress) {
      throw new Error('Missing required transfer information');
    }
    
    // Update state
    ctx.session.transferState = {
      ...state,
      step: 'complete'
    };
    
    // Check if approval is needed
    const isApproved = await safeBatchTransferContract.isApprovedForAll(wallet.address);
    
    // Show message based on approval status
    if (isApproved) {
      // Ready to execute
      await ctx.editMessageText('Ready to execute transfer. Please confirm to proceed.', {
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('✅ Execute Transfer', 'transfer:execute'),
              Markup.button.callback('❌ Cancel', 'transfer:cancel')
            ]
          ]
        }
      });
    } else {
      // Need approval first
      await ctx.editMessageText(
        'You need to approve the transfer contract before proceeding. This is a one-time approval that allows the contract to transfer your Axies.\n\n' +
        'Please confirm to approve the contract.',
        {
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback('✅ Approve Contract', 'transfer:execute'),
                Markup.button.callback('❌ Cancel', 'transfer:cancel')
              ]
            ]
          }
        }
      );
    }
    
    logger.info('Transfer confirmed', { userId, axieCount: state.axieIds.length });
  } catch (error) {
    logger.error('Error handling transfer confirmation', { error, userId });
    await ctx.editMessageText('Sorry, there was an error processing your confirmation. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Home', callback_data: 'start:menu' }]
        ]
      }
    });
  }
}

/**
 * Execute the transfer
 * @param ctx Context
 * @param userId User ID
 * @param wallet Wallet
 */
async function executeTransfer(ctx: any, userId: number, wallet: any): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    const state = ctx.session.transferState;
    
    if (!state || !state.axieIds || !state.recipientAddress) {
      throw new Error('Missing required transfer information');
    }
    
    // Show processing message
    await ctx.editMessageText('Processing your transfer request. Please wait...', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⏳ Processing...', callback_data: 'do_nothing' }]
        ]
      }
    });
    
    // Check if approval is needed
    const isApproved = await safeBatchTransferContract.isApprovedForAll(wallet.address);
    
    // Get wallet instance
    const walletInstance = await walletService.getWalletInstance(
      ctx.dbConnection,
      wallet.id,
      userId
    );
    
    // If not approved, approve first
    if (!isApproved) {
      await ctx.editMessageText('Approving transfer contract. Please wait...');
      
      const approvalResult = await safeBatchTransferContract.setApprovalForAll(walletInstance);
      
      if (!approvalResult.success) {
        throw new Error(`Failed to approve contract: ${approvalResult.error}`);
      }
      
      await ctx.editMessageText(
        '✅ Contract approved successfully!\n\nNow executing the transfer. Please wait...'
      );
    }
    
    // Execute transfer
    const transferResult = await safeBatchTransferContract.batchTransferToSingleRecipient(
      walletInstance,
      state.axieIds,
      state.recipientAddress
    );
    
    if (!transferResult.success) {
      throw new Error(`Transfer failed: ${transferResult.error}`);
    }
    
    // Save transfer to database
    await saveTransferRecord(
      ctx.dbConnection,
      userId,
      wallet.id,
      state.axieIds,
      state.recipientAddress,
      transferResult.txHash
    );
    
    // Show success message
    const explorerLink = `https://explorer.roninchain.com/tx/${transferResult.txHash}`;
    
    await ctx.editMessageText(
      `✅ *Transfer Successful!*\n\n` +
      `Successfully transferred ${state.axieIds.length} Axies to:\n` +
      `\`${formatAddress(state.recipientAddress)}\`\n\n` +
      `Transaction Hash: [${formatTxHash(transferResult.txHash)}](${explorerLink})\n\n` +
      `You can view the transaction on [Ronin Explorer](${explorerLink}).`,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.url('View Transaction', explorerLink),
              Markup.button.callback('🏠 Home', 'start:menu')
            ]
          ]
        }
      }
    );

    /* --------------------------------------------------------------
     * Send Axie IDs in a separate plain-text message, each line
     * with just the raw ID on its own line (no prefix).
     * ------------------------------------------------------------ */
    try {
      const idLines = state.axieIds.join('\n');
      await ctx.reply(idLines, { disable_web_page_preview: true });
    } catch (e) {
      logger.error('Failed to send Axie ID list message', { error: e, userId });
    }
    
    /* --------------------------------------------------------------
     * Fire-and-forget Google Sheets audit log.
     * ------------------------------------------------------------ */
    (async () => {
      try {
        await sheetsService.logTransferAction({
          collection:
            state.collection === 'all'
              ? 'All'
              : formatCollectionName(state.collection as string),
          quantity: state.axieIds.length,
          axieIds: state.axieIds.map(String),
          txHash: transferResult.txHash,
          wallet: wallet.address,
          totalAmount: 0,
          gasUsed: 0,
          status: 'success'
        });
      } catch (sheetErr) {
        logger.error('Failed to log transfer action to Google Sheets', {
          error: sheetErr,
          userId
        });
      }
    })();

    // Clear transfer state
    ctx.session.transferState = null;
    
    logger.info('Transfer executed successfully', { 
      userId,
      txHash: transferResult.txHash,
      axieCount: state.axieIds.length
    });
  } catch (error) {
    logger.error('Error executing transfer', { error, userId });
    // Escape Markdown-v2 special characters in the error message so Telegram
    // does not choke on characters like `_` or `[` which were causing:
    //   “Bad Request: can't parse entities”
    const rawMessage = error?.message || 'Unknown error';
    const errorMessage = rawMessage.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');

    await ctx.editMessageText(
      `❌ *Transfer Failed*\\n\\n` +
      `There was an error executing the transfer:\\n` +
      `${errorMessage}\\n\\n` +
      `Please try again later.`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Home', callback_data: 'start:menu' }]
          ]
        }
      }
    );
  }
}

/**
 * Handle cancel transfer
 * @param ctx Context
 */
async function handleCancelTransfer(ctx: any): Promise<void> {
  try {
    await ctx.answerCbQuery('Transfer cancelled');
    
    // Clear transfer state
    ctx.session.transferState = null;
    
    // Show cancellation message
    await ctx.editMessageText('Transfer cancelled. What would you like to do next?', {
      reply_markup: {
        inline_keyboard: [
          [
            Markup.button.callback('🔄 New Transfer', 'transfer:back:select_collection'),
            Markup.button.callback('🏠 Home', 'start:menu')
          ]
        ]
      }
    });
    
    logger.info('Transfer cancelled', { userId: ctx.from?.id });
  } catch (error) {
    logger.error('Error cancelling transfer', { error });
    await ctx.editMessageText('Sorry, there was an error cancelling the transfer. Please try again.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Home', callback_data: 'start:menu' }]
        ]
      }
    });
  }
}

/**
 * Handle back navigation
 * @param ctx Context
 * @param wallet Wallet
 * @param step Step to go back to
 */
async function handleBackNavigation(ctx: any, wallet: any, step: string): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    switch (step) {
      case 'select_collection':
        // Go back to collection selection
        ctx.session.transferState = {
          step: 'select_collection'
        };
        await showCollectionSelection(ctx, wallet.address);
        break;
      case 'enter_address':
        // Go back to address input
        if (ctx.session.transferState?.collection && ctx.session.transferState?.axieIds) {
          ctx.session.transferState = {
            ...ctx.session.transferState,
            recipientAddress: undefined,
            step: 'enter_address'
          };
          
          const collection = ctx.session.transferState.collection;
          const axieIds = ctx.session.transferState.axieIds;
          
          const message = `
🔄 *Transfer Axies*

You've selected to transfer ${axieIds.length} Axies ${collection === 'all' ? 'from all collections' : `from the ${formatCollectionName(collection)} collection`}.

Please enter the recipient's Ronin wallet address:
• Format: ronin:... or 0x...
• Double-check the address to avoid loss of assets!
          `;
          
          await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to Collections', callback_data: 'transfer:back:select_collection' }],
                [{ text: '❌ Cancel Transfer', callback_data: 'transfer:cancel' }]
              ]
            }
          });
        } else {
          // If state is invalid, go back to collection selection
          ctx.session.transferState = {
            step: 'select_collection'
          };
          await showCollectionSelection(ctx, wallet.address);
        }
        break;
      default:
        // Default to collection selection
        ctx.session.transferState = {
          step: 'select_collection'
        };
        await showCollectionSelection(ctx, wallet.address);
        break;
    }
    
    logger.info('Back navigation handled', { userId: ctx.from?.id, step });
  } catch (error) {
    logger.error('Error handling back navigation', { error, step });
    await ctx.editMessageText('Sorry, there was an error navigating back. Please try again.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Home', callback_data: 'start:menu' }]
        ]
      }
    });
  }
}

/**
 * Get Axies by collection for a wallet
 * @param walletAddress Wallet address
 * @returns Object with Axie IDs by collection
 */
async function getAxiesByCollection(walletAddress: string): Promise<Record<string, string[]>> {
  try {
    // Convert ronin: format to 0x format for blockchain calls
    const ethAddress = walletAddress.startsWith('ronin:')
      ? '0x' + walletAddress.substring(6)
      : walletAddress;
    
    // Initialize collections
    const collections = Object.values(AxieCollection);
    const axiesByCollection: Record<string, string[]> = collections.reduce((acc, collection) => {
      acc[collection] = [];
      return acc;
    }, {});
    
    // Get Axie contract
    const axieContract = tokenService.getAxieContract();
    
    // Get total Axie count
    const balance = await axieContract.balanceOf(ethAddress);
    const totalAxies = parseInt(balance.toString());
    
    if (totalAxies === 0) {
      return axiesByCollection;
    }
    
    // Get Axie IDs
    const axieIds = await getWalletAxieIds(ethAddress);
    
    // Get Axie details and categorize by collection
    for (const axieId of axieIds) {
      try {
        const axie = await marketplaceService.getAxieDetails(axieId);
        
        if (axie && axie.collection) {
          axiesByCollection[axie.collection].push(axieId);
        } else {
          // Default to regular if collection not specified
          axiesByCollection[AxieCollection.REGULAR].push(axieId);
        }
      } catch (error) {
        logger.error('Error fetching Axie details', { error, axieId });
        // If we can't determine collection, put in regular
        axiesByCollection[AxieCollection.REGULAR].push(axieId);
      }
    }
    
    return axiesByCollection;
  } catch (error) {
    logger.error('Error getting Axies by collection', { error, walletAddress });
    throw error;
  }
}

/**
 * Get all Axie IDs owned by a wallet
 * @param walletAddress Wallet address
 * @returns Array of Axie IDs
 */
async function getWalletAxieIds(walletAddress: string): Promise<string[]> {
  try {
    // Address provided here should already be in 0x format, but we still
    // normalise defensively in case other callers reuse this helper.
    const ethAddress = walletAddress.startsWith('ronin:')
      ? '0x' + walletAddress.substring(6)
      : walletAddress;

    // Use the marketplace API to get Axies owned by the wallet
    const axies = await marketplaceService.getAxiesByOwner(ethAddress);
    return axies.map(axie => axie.id);
  } catch (error) {
    logger.error('Error getting wallet Axie IDs', { error, walletAddress });
    throw error;
  }
}

/**
 * Get Axie details for display
 * @param axieIds Array of Axie IDs
 * @returns Array of Axie details
 */
async function getAxieDetailsForDisplay(axieIds: string[]): Promise<any[]> {
  try {
    /*
     * The public GraphQL API does not expose a reliable “batch by IDs”
     * endpoint.  We therefore:
     *   1. Fetch details for the first 10 Axies individually (reasonable UX).
     *   2. For the remaining Axies we fall back to lightweight placeholders
     *      to avoid hitting rate-limits or long delays.
     */
    const idsToFetch = axieIds.slice(0, 10);
    const axieDetails: any[] = [];

    for (const id of idsToFetch) {
      try {
        const axie = await marketplaceService.getAxieDetails(id);
        axieDetails.push(axie);
      } catch (err) {
        // If an individual fetch fails we still push a placeholder so the
        // ordering/count stays consistent.
        logger.warn('Failed fetching Axie detail – using placeholder', { id, err });
        axieDetails.push({ id, name: `Axie #${id}`, class: 'Unknown' });
      }
    }

    // Append placeholders for any remaining IDs beyond the fetch limit.
    for (let i = 10; i < axieIds.length; i++) {
      const id = axieIds[i];
      axieDetails.push({ id, name: `Axie #${id}`, class: 'Unknown' });
    }

    return axieDetails;
  } catch (error) {
    logger.error('Error getting Axie details for display', { error, axieIds });
    return axieIds.map(id => ({ id, name: `Axie #${id}`, class: 'Unknown' }));
  }
}

/**
 * Validate and normalize Ronin address
 * @param address Address to validate
 * @returns Normalized address or null if invalid
 */
function validateAndNormalizeAddress(address: string): string | null {
  try {
    // Check if address is valid
    if (!address) return null;
    
    // Normalize address
    let normalizedAddress = address.trim();
    
    // Convert ronin: prefix to 0x
    if (normalizedAddress.startsWith('ronin:')) {
      normalizedAddress = '0x' + normalizedAddress.substring(6);
    }
    
    // Check if address is valid Ethereum address
    if (!ethers.isAddress(normalizedAddress)) {
      return null;
    }
    
    return normalizedAddress;
  } catch (error) {
    logger.error('Error validating address', { error, address });
    return null;
  }
}

/**
 * Format address for display
 * @param address Address to format
 * @returns Formatted address
 */
function formatAddress(address: string): string {
  if (!address) return '';
  
  // Convert to ronin: format for display
  if (address.startsWith('0x')) {
    return 'ronin:' + address.substring(2);
  }
  
  return address;
}

/**
 * Format transaction hash for display
 * @param txHash Transaction hash
 * @returns Formatted transaction hash
 */
function formatTxHash(txHash: string): string {
  if (!txHash) return '';
  return `${txHash.substring(0, 6)}...${txHash.substring(txHash.length - 4)}`;
}

/**
 * Format collection name for display
 * @param collection Collection name
 * @returns Formatted collection name
 */
function formatCollectionName(collection: string): string {
  if (!collection) return '';
  
  // Replace underscores with spaces and capitalize
  return collection
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Get emoji for collection
 * @param collection Collection name
 * @returns Emoji for collection
 */
function getCollectionEmoji(collection: string): string {
  switch (collection) {
    case AxieCollection.ORIGIN:
      return '🌟';
    case AxieCollection.ORIGIN_GEN0:
      return '🌠';
    case AxieCollection.MYSTIC:
      return '✨';
    case AxieCollection.MEO_CORP:
    case AxieCollection.MEO_CORP_II:
      return '💎';
    case AxieCollection.SUMMER_2022:
      return '🌞';
    case AxieCollection.CHRISTMAS:
      return '🎄';
    case AxieCollection.NIGHTMARE:
      return '🌙';
    case AxieCollection.JAPANESE:
      return '🌸';
    case AxieCollection.SHINY:
      return '⚡';
    case AxieCollection.REGULAR:
    default:
      return '🐣';
  }
}

/**
 * Save transfer record to database
 * @param db Database connection
 * @param userId User ID
 * @param walletId Wallet ID
 * @param axieIds Array of Axie IDs
 * @param recipientAddress Recipient address
 * @param txHash Transaction hash
 */
async function saveTransferRecord(
  db: any,
  userId: number,
  walletId: number,
  axieIds: string[],
  recipientAddress: string,
  txHash: string
): Promise<void> {
  try {
    // Insert transfer record
    await db('transfers').insert({
      user_id: userId,
      wallet_id: walletId,
      tx_hash: txHash,
      axie_ids: JSON.stringify(axieIds),
      recipient_address: recipientAddress,
      axie_count: axieIds.length,
      status: 'completed',
      created_at: new Date(),
      updated_at: new Date()
    });
    
    logger.info('Transfer record saved', { userId, txHash, axieCount: axieIds.length });
  } catch (error) {
    logger.error('Error saving transfer record', { error, userId, txHash });
    // Don't throw error, just log it - the transfer was successful even if saving failed
  }
}
