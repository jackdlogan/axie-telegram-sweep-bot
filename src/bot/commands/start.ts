// @ts-nocheck
import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';
import WalletService from '../../services/walletService';
import TokenService from '../../services/tokenService';
import priceService from '../../services/priceService';
import MarketplaceService, { AxieCollection } from '../../services/marketplaceService';

// Initialize logger and services
const logger = new Logger('command:start');
const walletService = new WalletService();
const tokenService = new TokenService();
const marketplaceService = new MarketplaceService();

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
    
    // Check if user has any wallets
    // First, get the internal user record (id) using telegram_id
    const dbUser = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');

    const dbUserId = dbUser?.id;

    // Get user wallet
    let wallet = null;
    let hasWallet = false;
    if (dbUserId) {
      try {
        wallet = await walletService.getUserWallet(ctx.dbConnection, dbUserId);
        hasWallet = !!wallet;
      } catch (err) {
        // Already logged inside wallet service, just proceed as if no wallet.
        hasWallet = false;
      }
    }
    
    // Initialize wallet info section
    let walletInfoSection = '';
    
    // Total Axies held by the user (default 0 – updated if wallet exists)
    let axieHoldings = 0;
    
    // If user has a wallet, fetch and display wallet information
    if (hasWallet) {
      try {
        // Fetch wallet address and balances
        const address = wallet.address; // might be in ronin: format
        
        // Convert to 0x format if needed for blockchain interactions
        const ethAddress = address.startsWith('ronin:') 
          ? walletService.roninToEthAddress(address) 
          : address;
        
        // Get RON balance (native token)
        const ronBalance = await tokenService.getRonBalance(ethAddress);
        const ronUsdPrice = await priceService.ronToUsd(ronBalance);
        
        // Get WETH balance (wrapped ETH)
        const wethBalance = await tokenService.getWethBalance(ethAddress);
        const wethUsdPrice = await priceService.ethToUsd(wethBalance);
        
        // Fetch Axie NFT holdings
        axieHoldings = await getAxieHoldings(ethAddress);
        
        // Format wallet info section - use original address format for display
        walletInfoSection = `
💼 *Your Wallet*
\`${address}\` _(tap to copy)_

💰 *Balances*
• RON: ${ronBalance.toFixed(6)} ($${ronUsdPrice.toFixed(2)})
• WETH: ${wethBalance.toFixed(6)} ($${wethUsdPrice.toFixed(2)})

🥔 *Your Axies*
${formatAxieHoldings(axieHoldings)}
        
`;
      } catch (error) {
        logger.error('Error fetching wallet information', { error, userId });
        walletInfoSection = `
💼 *Your Wallet*
_Error fetching wallet information. Please try again later._
        
`;
      }
    }
    
    // Welcome message with bot introduction
    const welcomeMessage = `${walletInfoSection}
🎮 *Axie Marketplace Sweep Bot* 🎮

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
    
    /**
     * Inline keyboard for quick actions
     *
     * Order (row-wise):
     *  1. Start Sweeping | Sweeping History
     *  2. Transfer Axies (if user has axies) | Manage/Setup Wallet
     *  3. Help & Commands | 🔄 Refresh
     */
    const keyboardButtons: any[] = [];

    // Row 1: Sweeping actions
    keyboardButtons.push([
      Markup.button.callback('🧹 Start Sweeping', 'marketplace:menu'),
      Markup.button.callback('📜 Sweeping History', 'sweep:history')
    ]);

    // Row 2: Transfer Axies (only if user has at least 1 Axie) + Wallet button
    const secondRow: any[] = [];

    const hasAxies = hasWallet && (typeof axieHoldings === 'number') && axieHoldings > 0;
    if (hasAxies) {
      secondRow.push(Markup.button.callback('🔄 Transfer Axies', 'transfer:start'));
    }

    secondRow.push(
      Markup.button.callback(hasWallet ? '🔑 Manage Wallet' : '🔑 Setup Wallet', 'wallet:setup')
    );

    if (secondRow.length > 0) {
      keyboardButtons.push(secondRow);
    }

    // Row 3: Help & Refresh
    keyboardButtons.push([
      Markup.button.callback('❓ Help & Commands', 'help:commands'),
      Markup.button.callback('🔄 Refresh', 'start:refresh')
    ]);

    const keyboard = Markup.inlineKeyboard(keyboardButtons);
    
    /**
     * Decide whether we should send a new message (normal /start)
     * or edit the existing message (when invoked from an inline-button
     * that uses callback data = 'start').
     */
    let sentSuccessfully = false;
    if (ctx.callbackQuery) {
      // Acknowledge the callback to remove Telegram loading state
      await ctx.answerCbQuery();
      try {
        // Try to edit the message that contained the button
        await ctx.editMessageText(welcomeMessage, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup
        });
        sentSuccessfully = true;
      } catch (err) {
        // Editing might fail if the original message is too old or not editable
        logger.warn('Failed to edit message for /start callback – sending new one', { err });
      }
    }

    // Fallback or normal flow: send a fresh message
    if (!sentSuccessfully) {
      await ctx.replyWithMarkdown(welcomeMessage, keyboard);
    }
    
    logger.info('Start command completed', { userId });
  } catch (error) {
    logger.error('Error handling start command', { error });
    await ctx.reply('Sorry, there was an error starting the bot. Please try again later.');
  }
}

/**
 * Get Axie NFT holdings for a wallet address
 * @param address Wallet address
 * @returns Total number of Axies owned
 */
async function getAxieHoldings(address: string): Promise<number> {
  try {
    // Get total Axie count
    // getAxieContract is synchronous – no need to await
    const axieContract = tokenService.getAxieContract();
    const balance = await axieContract.balanceOf(address);
    const totalAxies = parseInt(balance.toString());
    
    logger.info('Fetched Axie holdings', { address, totalAxies });
    return totalAxies;
  } catch (error) {
    logger.error('Error fetching Axie holdings', { error, address });
    return 0;
  }
}

/**
 * Format Axie holdings for display
 * @param totalAxies Total number of Axies
 * @returns Formatted string
 */
function formatAxieHoldings(totalAxies: number): string {
  if (totalAxies === 0) {
    return 'No Axies found';
  }
  
  return `🐣 Total Axies: ${totalAxies}`;
}
