import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';
import WalletService from '../../services/walletService';

// Initialize logger
const logger = new Logger('command:balance');

// Initialize wallet service
const walletService = new WalletService();

/**
 * Handle the /balance command
 * Shows balances for all user wallets
 */
export async function handleBalanceCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('Balance command received', { userId });
    
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
    
    if (wallets.length === 0) {
      await ctx.reply('You don\'t have any wallets yet.', {
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('🆕 Create New Wallet', 'wallet:create'),
              Markup.button.callback('📥 Import Existing Wallet', 'wallet:import')
            ]
          ]
        }
      });
      return;
    }
    
    // Show loading message
    await ctx.reply('💰 Fetching wallet balances... Please wait.');
    
    // Format wallets for display and fetch balances
    let message = '💰 *Wallet Balances*\n\n';
    let totalRon = 0;
    let totalAxs = 0;
    let totalSlp = 0;
    
    // Fetch balances for each wallet
    for (const wallet of wallets) {
      try {
        const balances = await walletService.getTokenBalances(wallet.address);
        const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
        const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
        
        const ronBalance = parseFloat(balances.ron);
        const axsBalance = parseFloat(balances.axs);
        const slpBalance = parseFloat(balances.slp);
        
        totalRon += ronBalance;
        totalAxs += axsBalance;
        totalSlp += slpBalance;
        
        message += `*${name}* ${wallet.isActive ? '✅' : ''}\n`;
        message += `Address: \`${shortAddress}\`\n`;
        message += `RON: ${ronBalance.toFixed(4)}\n`;
        message += `AXS: ${axsBalance.toFixed(4)}\n`;
        message += `SLP: ${slpBalance.toFixed(2)}\n\n`;
      } catch (error) {
        logger.error('Error fetching balance for wallet', { error, address: wallet.address });
        
        const name = wallet.name || `Wallet ${wallet.address.substring(0, 6)}`;
        const shortAddress = `${wallet.address.substring(0, 8)}...${wallet.address.substring(wallet.address.length - 6)}`;
        
        message += `*${name}* ${wallet.isActive ? '✅' : ''}\n`;
        message += `Address: \`${shortAddress}\`\n`;
        message += `Error fetching balances\n\n`;
      }
    }
    
    // Add total balances section
    message += `*Total Balances Across All Wallets:*\n`;
    message += `Total RON: ${totalRon.toFixed(4)}\n`;
    message += `Total AXS: ${totalAxs.toFixed(4)}\n`;
    message += `Total SLP: ${totalSlp.toFixed(2)}\n`;
    
    // Edit message with balance information
    await ctx.replyWithMarkdown(message, {
      reply_markup: {
        inline_keyboard: [
          [
            Markup.button.callback('🔄 Refresh Balances', 'wallet:balance'),
            Markup.button.callback('🔑 Wallet Management', 'wallet:list')
          ],
          [
            Markup.button.callback('🧹 Start Sweeping', 'sweep:start')
          ]
        ]
      }
    });
    
    logger.info('Wallet balances displayed', { userId, walletCount: wallets.length });
  } catch (error) {
    logger.error('Error handling balance command', { error });
    await ctx.reply('Sorry, there was an error checking your wallet balances. Please try again later.');
  }
}
