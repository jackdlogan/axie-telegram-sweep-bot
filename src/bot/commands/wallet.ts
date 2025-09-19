// @ts-nocheck
import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import { ethers } from 'ethers';
import Logger from '../../utils/logger';
import WalletService from '../../services/walletService';
import TokenService from '../../services/tokenService';
import priceService from '../../services/priceService';
import config from '../../config';

// Initialize logger
const logger = new Logger('command:wallet');

// Initialize services
const walletService = new WalletService();
const tokenService = new TokenService();

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
    
    // SINGLE-WALLET MODE - Get the user's single wallet
    const wallet = await walletService.getUserWallet(ctx.dbConnection, user.id);
    
    // Create wallet menu message
    let message = '🔑 *Wallet Management*\n\n';
    
    if (wallet) {
      const shortAddr = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
      message += `*Current Wallet*
Name   : ${wallet.name || 'Wallet'}
Address: \`${shortAddr}\`

What would you like to do?`;
    } else {
      message +=
        'You don\'t have a wallet yet. Would you like to create a new wallet or import an existing one?';
    }
    
    // Create inline keyboard based on wallet existence
    let keyboard;
    keyboard = wallet
      ? Markup.inlineKeyboard([
          [
            Markup.button.callback('💰 Check Balance', 'wallet:balance'),
            Markup.button.callback('💸 Withdraw Funds', 'wallet:withdraw')
          ],
          [
            Markup.button.callback('✏️ Rename Wallet', 'wallet:rename'),
            Markup.button.callback('🗑️ Remove Wallet', 'wallet:remove')
          ],
          [
            Markup.button.callback('🆕 Replace Wallet', 'wallet:create'),
            Markup.button.callback('📥 Import / Replace', 'wallet:import')
          ],
          [
            Markup.button.callback('🔙 Back to Main Menu', 'start')
          ]
        ])
      : Markup.inlineKeyboard([
          [
            Markup.button.callback('🆕 Create Wallet', 'wallet:create'),
            Markup.button.callback('📥 Import Wallet', 'wallet:import')
          ],
          [
            Markup.button.callback('🔙 Back to Main Menu', 'start')
          ]
        ]);
    
    // Send wallet menu
    await ctx.replyWithMarkdown(message, keyboard);
    
    logger.info('Wallet command completed', { userId });
  } catch (error) {
    logger.error('Error handling wallet command', { error });
    await ctx.reply('Sorry, there was an error accessing your wallet. Please try again later.');
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
      await ctx.answerCbQuery('Please start the bot with /start first.');
      return;
    }
    
    // Handle different wallet actions - simplified for single wallet
    switch (action) {
      case 'create':
        await handleCreateWallet(ctx, user.id);
        break;
      case 'import':
        await handleImportWallet(ctx, user.id);
        break;
      case 'balance':
        await handleCheckBalance(ctx, user.id);
        break;
      case 'rename':
        await handleRenameWallet(ctx, user.id);
        break;
      case 'withdraw':
        await handleWithdrawFunds(ctx, user.id);
        break;
      case 'withdraw_ron':
        await handleWithdrawToken(ctx, user.id, 'RON');
        break;
      case 'withdraw_weth':
        await handleWithdrawToken(ctx, user.id, 'WETH');
        break;
      case 'withdraw_confirm':
        // Get withdrawal details from session
        await handleWithdrawConfirm(ctx, user.id);
        break;
      case 'withdraw_cancel':
        // Cancel withdrawal
        await ctx.answerCbQuery('Withdrawal cancelled');
        await handleWithdrawFunds(ctx, user.id);
        break;
      case 'remove':
        await handleRemoveWallet(ctx, user.id);
        break;
      case 'remove_confirmed':
        await handleRemoveWalletConfirmed(ctx, user.id);
        break;
      case 'setup':
        // Redirect to wallet command
        await handleWalletCommand(ctx);
        break;
      default:
        // Handle dynamic callback data for withdrawals
        if (action.startsWith('withdraw_amount_')) {
          const token = action.split('_')[2];
          await handleWithdrawAmount(ctx, user.id, token);
        } else if (action.startsWith('withdraw_address_')) {
          const parts = action.split('_');
          const token = parts[2];
          const amount = parts[3];
          await handleWithdrawAddress(ctx, user.id, token, amount);
        } else {
          await ctx.answerCbQuery('Unknown action');
        }
        break;
    }
    
    logger.info('Wallet callback completed', { userId, action });
  } catch (error) {
    logger.error('Error handling wallet callback', { error });
    await ctx.answerCbQuery('An error occurred. Please try again.');
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
    // Check if user already has a wallet
    const existingWallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    // If user already has a wallet, ask for confirmation
    if (existingWallet) {
      await ctx.answerCbQuery();
      
      const message = `
⚠️ *Replace Existing Wallet?* ⚠️

You already have a wallet:
*${existingWallet.name || 'Wallet'}* (\`${existingWallet.address.substring(0, 8)}...\`)

Creating a new wallet will replace your current one. This action cannot be undone.

Do you want to continue?
      `;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('✅ Yes, Replace Wallet', 'wallet:create_confirmed'),
              Markup.button.callback('❌ No, Keep Current Wallet', 'wallet:setup')
            ]
          ]
        }
      });
      
      // Set session state for create confirmation
      ctx.session.walletAction = 'create_confirm';
      
      return;
    }
    
    // If no existing wallet or user confirmed replacement
    if (ctx.callbackQuery.data === 'wallet:create_confirmed' || !existingWallet) {
      await ctx.answerCbQuery('Creating new wallet...');
      
      // --------------------  STEP 1: Generate Wallet  --------------------
      logger.info('Starting wallet creation', { userId });
      // Generate new wallet
      const wallet = walletService.generateWallet();
      logger.info('Wallet generated successfully', {
        userId,
        address: wallet.address,
        hasPrivateKey: !!wallet.privateKey
      });
      
      // Convert to Ronin address format for display
      const roninAddress = walletService.ethToRoninAddress(wallet.address);
      logger.info('Converted to Ronin address', { userId, roninAddress });

      // Default wallet name using Ronin address
      const walletName = `Wallet ${roninAddress.substring(6, 12)}`;
      logger.info('Wallet name created', { userId, walletName });
      
      // Save wallet to database
      try {
        logger.info('Attempting to save wallet to database', {
          userId,
          roninAddress,
          walletName,
          dbConnection: !!ctx.dbConnection
        });
        await walletService.saveWallet(ctx.dbConnection, userId, wallet, walletName);
        logger.info('Wallet saved successfully', { userId, roninAddress });
      } catch (saveError) {
        logger.error('Error saving wallet to database', {
          userId,
          error:
            saveError instanceof Error ? saveError.message : String(saveError),
          stack: saveError instanceof Error ? saveError.stack : ''
        });
        throw saveError; // re-throw so outer catch handles user notification
      }
      
      // Show success message with wallet information
      const message = `
🎉 *New Wallet Created Successfully!*

*Address:* \`${roninAddress}\`
*Private Key:* \`${wallet.privateKey}\`

⚠️ *IMPORTANT: Save your private key securely!* ⚠️
This is the only time your private key will be shown. Store it in a safe place. Anyone with this key can access your funds.

Your wallet has been saved and is ready to use.
      `;
      
      await ctx.replyWithMarkdown(message, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 Check Balance', callback_data: 'wallet:balance' }],
            [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
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
    }
  } catch (error) {
    // Improve error serialization so we can debug wallet creation failures
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    let fullError: string;
    try {
      // Attempt to stringify all enumerable + non-enumerable properties
      fullError = JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      fullError = String(error);
    }

    logger.error('Error creating wallet', {
      error: errorMessage,
      stack: errorStack,
      userId,
      fullError
    });
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
    // Check if user already has a wallet
    const existingWallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    // If user already has a wallet, ask for confirmation
    if (existingWallet && !ctx.callbackQuery.data.includes('import_confirmed')) {
      await ctx.answerCbQuery();
      
      const message = `
⚠️ *Replace Existing Wallet?* ⚠️

You already have a wallet:
*${existingWallet.name || 'Wallet'}* (\`${existingWallet.address.substring(0, 8)}...\`)

Importing a new wallet will replace your current one. This action cannot be undone.

Do you want to continue?
      `;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('✅ Yes, Import New Wallet', 'wallet:import_confirmed'),
              Markup.button.callback('❌ No, Keep Current Wallet', 'wallet:setup')
            ]
          ]
        }
      });
      
      return;
    }
    
    await ctx.answerCbQuery();
    
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
          [{ text: '❌ Cancel', callback_data: 'wallet:setup' }]
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
 * Handle wallet balance check
 * @param ctx Context
 * @param userId User ID
 */
async function handleCheckBalance(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery('Checking balance...');
    
    // Get user's wallet - single wallet mode
    const wallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    if (!wallet) {
      await ctx.editMessageText('You don\'t have a wallet yet.', {
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
    await ctx.editMessageText('💰 Fetching wallet balance... Please wait.');
    
    try {
      const balances = await walletService.getTokenBalances(wallet.address);
      const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
      const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
      
      const message = `
💰 *Wallet Balance*

*${name}*
Address: \`${shortAddress}\`

*Balances:*
• RON: ${parseFloat(balances.ron).toFixed(4)}
• AXS: ${parseFloat(balances.axs).toFixed(4)}
• SLP: ${parseFloat(balances.slp).toFixed(2)}
      `;
      
      // Edit message with balance information
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Refresh', callback_data: 'wallet:balance' },
              { text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }
            ]
          ]
        }
      });
      
      logger.info('Wallet balance displayed', { userId, address: wallet.address });
    } catch (error) {
      logger.error('Error fetching balance for wallet', { error, address: wallet.address });
      
      const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
      const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
      
      const message = `
💰 *Wallet Balance*

*${name}*
Address: \`${shortAddress}\`

Error fetching balances. Please try again later.
      `;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Try Again', callback_data: 'wallet:balance' },
              { text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }
            ]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error checking wallet balance', { error, userId });
    await ctx.reply('Sorry, there was an error checking your wallet balance. Please try again later.');
  }
}

/**
 * Handle wallet rename
 * @param ctx Context
 * @param userId User ID
 */
async function handleRenameWallet(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Get user's wallet - single wallet mode
    const wallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    if (!wallet) {
      await ctx.editMessageText('You don\'t have a wallet to rename.', {
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
    
    const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
    
    // Create message
    const message = `
✏️ *Rename Wallet*

Current name: *${wallet.name || 'Wallet'}*
Address: \`${shortAddress}\`

Please send me the new name for your wallet.
    `;
    
    // Edit message with rename prompt
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'wallet:setup' }]
        ]
      }
    });
    
    // Set session state for rename
    ctx.session.walletAction = 'rename';
    ctx.session.walletId = wallet.id;
    
    logger.info('Wallet rename initiated', { userId, walletId: wallet.id });
  } catch (error) {
    logger.error('Error preparing wallet rename', { error, userId });
    await ctx.reply('Sorry, there was an error preparing to rename your wallet. Please try again later.');
  }
}

/**
 * Handle withdraw funds (show token selection)
 * @param ctx Context
 * @param userId User ID
 */
async function handleWithdrawFunds(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Get user's wallet
    const wallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    if (!wallet) {
      await ctx.editMessageText('You don\'t have a wallet to withdraw from.', {
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
    
    // Show token selection menu
    const message = `
💸 *Withdraw Funds*

Select the token you want to withdraw:
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'RON (Native Token)', callback_data: 'wallet:withdraw_ron' },
            { text: 'WETH (Wrapped ETH)', callback_data: 'wallet:withdraw_weth' }
          ],
          [
            { text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }
          ]
        ]
      }
    });
    
    logger.info('Withdraw funds initiated - token selection', { userId, walletId: wallet.id });
  } catch (error) {
    logger.error('Error handling withdraw funds', { error, userId });
    await ctx.reply('Sorry, there was an error preparing withdrawal. Please try again later.');
  }
}

/**
 * Handle token withdrawal (amount input)
 * @param ctx Context
 * @param userId User ID
 * @param token Token to withdraw
 */
async function handleWithdrawToken(ctx: any, userId: number, token: string): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Get user's wallet
    const wallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    if (!wallet) {
      await ctx.editMessageText('You don\'t have a wallet to withdraw from.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
          ]
        }
      });
      return;
    }
    
    // Get current balance
    let balance = 0;
    try {
      // Ensure address is in 0x format for provider queries
      const addressForQuery = wallet.address.startsWith('ronin:')
        ? walletService.roninToEthAddress(wallet.address)
        : wallet.address;

      if (token === 'RON') {
        balance = await tokenService.getRonBalance(addressForQuery);
      } else if (token === 'WETH') {
        balance = await tokenService.getWethBalance(addressForQuery);
      }
    } catch (error) {
      logger.error('Error fetching token balance', { error, userId, token });
    }
    
    // Show amount input prompt
    const message = `
💸 *Withdraw ${token}*

Current Balance: ${balance.toFixed(6)} ${token}

Please enter the amount of ${token} you want to withdraw:
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Max Amount', callback_data: `wallet:withdraw_amount_${token}_max` },
            { text: '🔙 Back', callback_data: 'wallet:withdraw' }
          ]
        ]
      }
    });
    
    // Set session state for amount input
    ctx.session.walletAction = `withdraw_amount_${token}`;
    ctx.session.withdrawToken = token;
    ctx.session.walletId = wallet.id;
    ctx.session.maxAmount = balance;
    
    logger.info('Withdraw amount input initiated', { userId, token, balance });
  } catch (error) {
    logger.error('Error handling token withdrawal', { error, userId, token });
    await ctx.reply('Sorry, there was an error preparing withdrawal. Please try again later.');
  }
}

/**
 * Handle withdrawal amount (address input)
 * @param ctx Context
 * @param userId User ID
 * @param token Token to withdraw
 */
async function handleWithdrawAmount(ctx: any, userId: number, token: string): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Check if this is a max amount request
    const isMax = ctx.callbackQuery.data.endsWith('_max');
    let amount = 0;
    
    if (isMax) {
      // Use max amount from session
      amount = ctx.session.maxAmount || 0;
      
      // Reserve some RON for gas if withdrawing RON
      if (token === 'RON') {
        // Reserve 0.01 RON for gas
        amount = Math.max(0, amount - 0.01);
      }
    } else {
      // Wait for user input
      const message = `
💸 *Withdraw ${token}*

Please enter the amount of ${token} you want to withdraw:
      `;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Max Amount', callback_data: `wallet:withdraw_amount_${token}_max` },
              { text: '🔙 Back', callback_data: 'wallet:withdraw' }
            ]
          ]
        }
      });
      
      // Set session state for amount input
      ctx.session.walletAction = `withdraw_amount_${token}`;
      
      return;
    }
    
    // If we have an amount (from max), proceed to address input
    if (amount > 0) {
      await handleWithdrawAddress(ctx, userId, token, amount.toString());
    } else {
      await ctx.editMessageText(`
⚠️ *Insufficient Balance*

Your ${token} balance is too low to withdraw.
      `, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Token Selection', callback_data: 'wallet:withdraw' }]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error handling withdrawal amount', { error, userId, token });
    await ctx.reply('Sorry, there was an error processing your withdrawal. Please try again later.');
  }
}

/**
 * Handle withdrawal address input
 * @param ctx Context
 * @param userId User ID
 * @param token Token to withdraw
 * @param amount Amount to withdraw
 */
async function handleWithdrawAddress(ctx: any, userId: number, token: string, amount: string): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
    }
    
    // Validate amount
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      await ctx.editMessageText(`
⚠️ *Invalid Amount*

Please enter a valid amount greater than 0.
      `, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Token Selection', callback_data: 'wallet:withdraw' }]
          ]
        }
      });
      return;
    }
    
    // Show address input prompt
    const message = `
💸 *Withdraw ${token}*

Amount: ${numAmount.toFixed(6)} ${token}

Please enter the recipient address (Ronin or Ethereum format):
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back', callback_data: `wallet:withdraw_${token.toLowerCase()}` }]
        ]
      }
    });
    
    // Set session state for address input
    ctx.session.walletAction = `withdraw_address_${token}_${amount}`;
    ctx.session.withdrawToken = token;
    ctx.session.withdrawAmount = amount;
    
    logger.info('Withdraw address input initiated', { userId, token, amount });
  } catch (error) {
    logger.error('Error handling withdrawal address input', { error, userId, token, amount });
    await ctx.reply('Sorry, there was an error processing your withdrawal. Please try again later.');
  }
}

/**
 * Handle withdrawal confirmation
 * @param ctx Context
 * @param userId User ID
 */
async function handleWithdrawConfirm(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Get withdrawal details from session
    const token = ctx.session.withdrawToken;
    const amount = ctx.session.withdrawAmount;
    const address = ctx.session.withdrawAddress;
    
    if (!token || !amount || !address) {
      await ctx.editMessageText('Withdrawal information is missing. Please try again.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
          ]
        }
      });
      return;
    }
    
    // Get wallet
    const wallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    if (!wallet) {
      await ctx.editMessageText('Wallet not found. Please try again.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
          ]
        }
      });
      return;
    }
    
    // Convert address to proper format if needed
    let recipientAddress = address;
    if (recipientAddress.startsWith('ronin:')) {
      recipientAddress = walletService.roninToEthAddress(recipientAddress);
    }
    
    // Validate address
    if (!walletService.isValidAddress(recipientAddress)) {
      await ctx.editMessageText(`
⚠️ *Invalid Address*

The address you entered is not valid. Please try again.
      `, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Token Selection', callback_data: 'wallet:withdraw' }]
          ]
        }
      });
      return;
    }
    
    // Get wallet instance
    const walletInstance = await walletService.getWalletInstance(
      ctx.dbConnection,
      wallet.id,
      userId
    );
    
    // Execute withdrawal
    try {
      // Show processing message
      await ctx.editMessageText(`
💸 *Processing Withdrawal*

Token: ${token}
Amount: ${parseFloat(amount).toFixed(6)} ${token}
To: ${address}

Please wait...
      `, {
        parse_mode: 'Markdown'
      });
      
      let txHash = '';
      
      if (token === 'RON') {
        // Send native RON
        const amountWei = walletService.ronToWei(amount);
        const tx = await walletService.sendTransaction(
          walletInstance,
          recipientAddress,
          amountWei
        );
        txHash = tx.hash;
      } else if (token === 'WETH') {
        // Send WETH token
        const amountWei = ethers.parseEther(amount);
        const tx = await walletService.sendToken(
          walletInstance,
          config.blockchain.wethTokenAddress,
          recipientAddress,
          amountWei
        );
        txHash = tx.hash;
      }
      
      // Show success message
      await ctx.editMessageText(`
✅ *Withdrawal Successful*

Token: ${token}
Amount: ${parseFloat(amount).toFixed(6)} ${token}
To: ${address}

Transaction: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 6)}
Explorer: https://explorer.roninchain.com/tx/${txHash}
      `, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
          ]
        }
      });
      
      // Clear withdrawal data from session
      ctx.session.withdrawToken = null;
      ctx.session.withdrawAmount = null;
      ctx.session.withdrawAddress = null;
      
      logger.info('Withdrawal successful', { userId, token, amount, address, txHash });
    } catch (error) {
      logger.error('Error executing withdrawal', { error, userId, token, amount, address });
      
      await ctx.editMessageText(`
❌ *Withdrawal Failed*

Token: ${token}
Amount: ${parseFloat(amount).toFixed(6)} ${token}
To: ${address}

Error: ${error.message || 'Unknown error'}

Please try again later.
      `, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error handling withdrawal confirmation', { error, userId });
    await ctx.reply('Sorry, there was an error processing your withdrawal. Please try again later.');
  }
}

/**
 * Handle remove wallet request
 * @param ctx Context
 * @param userId User ID
 */
async function handleRemoveWallet(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Get user's wallet
    const wallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    if (!wallet) {
      await ctx.editMessageText('You don\'t have a wallet to remove.', {
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
    
    const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
    
    // Ask for confirmation
    const message = `
⚠️ *Remove Wallet - WARNING* ⚠️

You are about to remove your wallet:
*${wallet.name || 'Wallet'}* (\`${shortAddress}\`)

This action cannot be undone. Make sure you have backed up your private key if you want to access this wallet in the future.

Are you sure you want to remove this wallet?
    `;
    
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes, Remove Wallet', callback_data: 'wallet:remove_confirmed' },
            { text: '❌ No, Keep Wallet', callback_data: 'wallet:setup' }
          ]
        ]
      }
    });
    
    logger.info('Wallet removal confirmation requested', { userId, walletId: wallet.id });
  } catch (error) {
    logger.error('Error handling remove wallet request', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Handle confirmed wallet removal
 * @param ctx Context
 * @param userId User ID
 */
async function handleRemoveWalletConfirmed(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    // Get user's wallet
    const wallet = await walletService.getUserWallet(ctx.dbConnection, userId);
    
    if (!wallet) {
      await ctx.editMessageText('No wallet found to remove.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
          ]
        }
      });
      return;
    }
    
    // Delete the wallet from the database
    await ctx.dbConnection('wallets')
      .where({ id: wallet.id, user_id: userId })
      .delete();
    
    // Show success message
    await ctx.editMessageText(`
✅ *Wallet Removed Successfully*

Your wallet has been removed from the system.

You can create a new wallet or import an existing one at any time.
    `, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🆕 Create New Wallet', callback_data: 'wallet:create' },
            { text: '📥 Import Wallet', callback_data: 'wallet:import' }
          ],
          [
            { text: '🔙 Back to Main Menu', callback_data: 'start' }
          ]
        ]
      }
    });
    
    logger.info('Wallet removed successfully', { userId, walletId: wallet.id });
  } catch (error) {
    logger.error('Error removing wallet', { error, userId });
    await ctx.reply('Sorry, there was an error removing your wallet. Please try again later.');
  }
}

/**
 * Process text input for wallet actions
 * This function should be called from the main bot file when text is received
 * @param ctx Context
 */
export async function processWalletTextInput(ctx: any): Promise<boolean> {
  try {
    const userId = ctx.from?.id;
    const text = ctx.message.text;
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return false;
    }
    
    // Check if we're expecting wallet action input
    if (!ctx.session.walletAction) {
      return false;
    }
    
    switch (ctx.session.walletAction) {
      case 'import':
        // Process private key or seed phrase
        try {
          let wallet;
          
          // Try to import as private key first
          try {
            wallet = walletService.importFromPrivateKey(text);
          } catch (e) {
            // If that fails, try as seed phrase
            wallet = walletService.importFromSeedPhrase(text);
          }
          
          // Convert to Ronin address for display
          const roninAddress = walletService.ethToRoninAddress(wallet.address);
          
          // Default wallet name
          const walletName = `Wallet ${roninAddress.substring(6, 12)}`;
          
          // Save wallet to database
          await walletService.saveWallet(ctx.dbConnection, user.id, wallet, walletName);
          
          // Delete the message with private key immediately
          try {
            await ctx.deleteMessage();
          } catch (error) {
            logger.warn('Could not delete message with private key', { error });
          }
          
          // Show success message
          await ctx.reply(`
✅ *Wallet Imported Successfully!*

*Address:* \`${roninAddress}\`

Your wallet has been saved and is ready to use.
          `, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💰 Check Balance', callback_data: 'wallet:balance' }],
                [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
              ]
            }
          });
          
          logger.info('Wallet imported successfully', { userId, address: wallet.address });
        } catch (error) {
          logger.error('Error importing wallet', { error, userId });
          await ctx.reply('Invalid private key or seed phrase. Please try again with a valid key.');
        }
        
        // Clear session state
        ctx.session.walletAction = null;
        return true;
        
      case 'rename':
        // Process wallet rename
        try {
          // Get wallet ID from session
          const walletId = ctx.session.walletId;
          
          if (!walletId) {
            await ctx.reply('Wallet not found. Please try again.');
            ctx.session.walletAction = null;
            return true;
          }
          
          // Update wallet name
          await ctx.dbConnection('wallets')
            .where({ id: walletId, user_id: user.id })
            .update({ 
              name: text,
              updated_at: new Date()
            });
          
          // Show success message
          await ctx.reply(`
✅ Wallet renamed successfully to "${text}".
          `, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to Wallet Menu', callback_data: 'wallet:setup' }]
              ]
            }
          });
          
          logger.info('Wallet renamed', { userId, walletId, newName: text });
        } catch (error) {
          logger.error('Error renaming wallet', { error, userId });
          await ctx.reply('Sorry, there was an error renaming your wallet. Please try again later.');
        }
        
        // Clear session state
        ctx.session.walletAction = null;
        ctx.session.walletId = null;
        return true;
        
      default:
        // Handle withdrawal amount input
        if (ctx.session.walletAction.startsWith('withdraw_amount_')) {
          const token = ctx.session.withdrawToken;
          const amount = text;
          
          // Validate amount
          try {
            const numAmount = parseFloat(amount);
            if (isNaN(numAmount) || numAmount <= 0) {
              await ctx.reply('Please enter a valid amount greater than 0.');
              return true;
            }
            
            // Check if amount exceeds balance
            const maxAmount = ctx.session.maxAmount || 0;
            if (numAmount > maxAmount) {
              await ctx.reply(`Amount exceeds your balance of ${maxAmount.toFixed(6)} ${token}.`);
              return true;
            }
            
            // Proceed to address input
            await handleWithdrawAddress(ctx, user.id, token, amount);
          } catch (error) {
            logger.error('Error processing withdrawal amount', { error, userId, token, amount });
            await ctx.reply('Invalid amount format. Please enter a valid number.');
          }
          
          return true;
        }
        
        // Handle withdrawal address input
        if (ctx.session.walletAction.startsWith('withdraw_address_')) {
          const token = ctx.session.withdrawToken;
          const amount = ctx.session.withdrawAmount;
          const address = text;
          
          // Validate address
          try {
            let recipientAddress = address;
            if (recipientAddress.startsWith('ronin:')) {
              recipientAddress = walletService.roninToEthAddress(recipientAddress);
            }
            
            if (!walletService.isValidAddress(recipientAddress)) {
              await ctx.reply('Invalid address format. Please enter a valid Ethereum or Ronin address.');
              return true;
            }
            
            // Store withdrawal details in session
            ctx.session.withdrawAddress = address;
            
            // Show confirmation
            const message = `
💸 *Confirm Withdrawal*

Token: ${token}
Amount: ${parseFloat(amount).toFixed(6)} ${token}
To: \`${address}\`

Are you sure you want to proceed with this withdrawal?
            `;
            
            await ctx.reply(message, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Confirm Withdrawal', callback_data: 'wallet:withdraw_confirm' },
                    { text: '❌ Cancel', callback_data: 'wallet:withdraw_cancel' }
                  ]
                ]
              }
            });
            
            // Clear action state but keep withdrawal details
            ctx.session.walletAction = null;
          } catch (error) {
            logger.error('Error processing withdrawal address', { error, userId, token, amount, address });
            await ctx.reply('Error processing address. Please try again.');
          }
          
          return true;
        }
        
        return false;
    }
  } catch (error) {
    logger.error('Error processing wallet text input', { error });
    await ctx.reply('Sorry, there was an error processing your input. Please try again later.');
    return true;
  }
}
