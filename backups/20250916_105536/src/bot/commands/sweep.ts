import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';
import MarketplaceService, { AxieCollection } from '../../services/marketplaceService';
import SweepService, { SweepOptions, SweepPreview } from '../../services/sweepService';
import WalletService from '../../services/walletService';

// Initialize logger
const logger = new Logger('command:sweep');

// Initialize services
const marketplaceService = new MarketplaceService();
const sweepService = new SweepService();
const walletService = new WalletService();

// Collection display names for better UI
const collectionNames: Record<AxieCollection, string> = {
  [AxieCollection.ORIGIN_GEN0]: 'Origin Gen 0',
  [AxieCollection.SUMMER_2022]: 'Summer 2022',
  [AxieCollection.NIGHTMARE]: 'Nightmare',
  [AxieCollection.CHRISTMAS]: 'Christmas (Xmas)',
  [AxieCollection.MEO_CORP]: 'MEO Corp',
  [AxieCollection.SHINY]: 'Shiny',
  [AxieCollection.JAPANESE]: 'Japanese',
  [AxieCollection.ORIGIN]: 'Origin',
  [AxieCollection.MYSTIC]: 'Mystic',
  [AxieCollection.REGULAR]: 'Regular Axies'
};

// Default quantity options
const quantityOptions = [5, 10, 20, 100];

/**
 * Handle the /sweep command
 * Shows collection selection and starts the sweep process
 */
export async function handleSweepCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('Sweep command received', { userId });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return;
    }
    
    // Check if user has any wallets
    const userWallets = await ctx.dbConnection('wallets')
      .where({ user_id: user.id })
      .count('id as count')
      .first();
    
    const walletCount = parseInt(userWallets?.count || '0');
    
    if (walletCount === 0) {
      await ctx.reply(
        '🔑 You need to set up a wallet before you can sweep Axies. Would you like to create a new wallet or import an existing one?',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('🆕 Create New Wallet', 'wallet:create'),
            Markup.button.callback('📥 Import Existing Wallet', 'wallet:import')
          ]
        ])
      );
      return;
    }
    
    // Show sweep menu
    await showSweepMenu(ctx, user.id);
    
    logger.info('Sweep command completed', { userId });
  } catch (error) {
    logger.error('Error handling sweep command', { error });
    await ctx.reply('Sorry, there was an error starting the sweep process. Please try again later.');
  }
}

/**
 * Handle sweep-related callbacks
 * @param ctx Context
 */
export async function handleSweepCallback(ctx: any): Promise<void> {
  try {
    // Extract callback data and user information
    const callbackData = ctx.callbackQuery.data;
    const action = callbackData.split(':')[1];
    const userId = ctx.from?.id;
    
    logger.info('Sweep callback received', { userId, action });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.answerCallbackQuery('Please start the bot with /start first.');
      return;
    }
    
    // Handle different sweep actions
    switch (action) {
      case 'start':
        await showSweepMenu(ctx, user.id);
        break;
      case 'collection':
        await handleCollectionSelection(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'quantity':
        await handleQuantitySelection(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'custom_quantity':
        await handleCustomQuantity(ctx, user.id);
        break;
      case 'max_price':
        await handleMaxPriceInput(ctx, user.id);
        break;
      case 'preview':
        await showSweepPreview(ctx, user.id);
        break;
      case 'confirm':
        await confirmSweep(ctx, user.id);
        break;
      case 'execute':
        await executeSweep(ctx, user.id);
        break;
      case 'stats':
        await showCollectionStats(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'all_stats':
        await showAllCollectionStats(ctx, user.id);
        break;
      case 'history':
        await showSweepHistory(ctx, user.id);
        break;
      case 'view_transaction':
        await viewTransactionDetails(ctx, user.id, callbackData.split(':')[2]);
        break;
      default:
        await ctx.answerCallbackQuery('Unknown action');
        break;
    }
    
    logger.info('Sweep callback completed', { userId, action });
  } catch (error) {
    logger.error('Error handling sweep callback', { error });
    await ctx.answerCallbackQuery('An error occurred. Please try again.');
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show the main sweep menu
 * @param ctx Context
 * @param userId User ID
 */
async function showSweepMenu(ctx: any, userId: number): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
    
    const message = `
🧹 *Axie Sweep Menu*

Welcome to the Axie Marketplace Sweep tool! What would you like to do?

*Options:*
• Start a new sweep - Select a collection and quantity to purchase
• View collection stats - Check floor prices and market depth
• View sweep history - See your past sweep transactions
    `;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🧹 Start New Sweep', 'sweep:collection:select'),
        Markup.button.callback('📊 Collection Stats', 'sweep:all_stats')
      ],
      [
        Markup.button.callback('📜 Sweep History', 'sweep:history'),
        Markup.button.callback('🔙 Main Menu', 'start')
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
    
    logger.info('Sweep menu displayed', { userId });
  } catch (error) {
    logger.error('Error showing sweep menu', { error, userId });
    await ctx.reply('Sorry, there was an error displaying the sweep menu. Please try again later.');
  }
}

/**
 * Handle collection selection
 * @param ctx Context
 * @param userId User ID
 * @param action Action (select or specific collection)
 */
async function handleCollectionSelection(ctx: any, userId: number, action: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    if (action === 'select') {
      // Show collection selection menu with floor prices
      await ctx.editMessageText('📊 Fetching collection data... Please wait.');
      
      try {
        // Get all collection stats
        const statsMap = await marketplaceService.getAllCollectionStats();
        
        let message = '🧹 *Select Collection to Sweep*\n\n';
        message += 'Current floor prices:\n\n';
        
        // Format collection stats
        for (const [collection, stats] of statsMap.entries()) {
          const name = collectionNames[collection] || collection;
          message += `*${name}*: ${stats.floorPrice.toFixed(4)} RON ($${stats.floorPriceUsd.toFixed(2)})\n`;
          message += `Listed: ${stats.totalListed} | Avg10: ${stats.avg10Price.toFixed(4)} RON\n\n`;
        }
        
        // Create collection buttons (2 per row)
        const collectionButtons = [];
        const collections = Object.values(AxieCollection);
        
        for (let i = 0; i < collections.length; i += 2) {
          const row = [];
          
          if (i < collections.length) {
            row.push(Markup.button.callback(
              collectionNames[collections[i]],
              `sweep:collection:${collections[i]}`
            ));
          }
          
          if (i + 1 < collections.length) {
            row.push(Markup.button.callback(
              collectionNames[collections[i + 1]],
              `sweep:collection:${collections[i + 1]}`
            ));
          }
          
          collectionButtons.push(row);
        }
        
        // Add back button
        collectionButtons.push([
          Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
        ]);
        
        // Edit message with collection selection
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: collectionButtons
          }
        });
        
        logger.info('Collection selection displayed', { userId });
      } catch (error) {
        logger.error('Error fetching collection stats', { error, userId });
        await ctx.editMessageText('Sorry, there was an error fetching collection data. Please try again later.', {
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🔄 Try Again', 'sweep:collection:select')],
              [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
            ]
          }
        });
      }
    } else {
      // User selected a specific collection
      const collection = action as AxieCollection;
      
      // Store selected collection in session
      ctx.session.sweepCollection = collection;
      
      // Show quantity selection
      await showQuantitySelection(ctx, userId, collection);
    }
  } catch (error) {
    logger.error('Error handling collection selection', { error, userId });
    await ctx.reply('Sorry, there was an error processing your collection selection. Please try again later.');
  }
}

/**
 * Show quantity selection menu
 * @param ctx Context
 * @param userId User ID
 * @param collection Selected collection
 */
async function showQuantitySelection(ctx: any, userId: number, collection: AxieCollection): Promise<void> {
  try {
    // Get collection stats
    const stats = await marketplaceService.getCollectionStats(collection);
    
    const message = `
🧹 *Select Quantity to Sweep*

Collection: *${collectionNames[collection]}*

*Current Stats:*
• Floor Price: ${stats.floorPrice.toFixed(4)} RON ($${stats.floorPriceUsd.toFixed(2)})
• Avg. of 10 cheapest: ${stats.avg10Price.toFixed(4)} RON
• Avg. of 50 cheapest: ${stats.avg50Price.toFixed(4)} RON
• Avg. of 100 cheapest: ${stats.avg100Price.toFixed(4)} RON
• Total Listed: ${stats.totalListed}

How many Axies would you like to sweep?
    `;
    
    // Create quantity buttons (2 per row)
    const quantityButtons = [];
    const row1 = [];
    const row2 = [];
    
    for (let i = 0; i < quantityOptions.length; i++) {
      const quantity = quantityOptions[i];
      const button = Markup.button.callback(
        `${quantity} Axies`,
        `sweep:quantity:${quantity}`
      );
      
      if (i < 2) {
        row1.push(button);
      } else {
        row2.push(button);
      }
    }
    
    quantityButtons.push(row1);
    quantityButtons.push(row2);
    
    // Add custom quantity button
    quantityButtons.push([
      Markup.button.callback('Custom Quantity', 'sweep:custom_quantity')
    ]);
    
    // Add back button
    quantityButtons.push([
      Markup.button.callback('🔙 Back to Collections', 'sweep:collection:select')
    ]);
    
    // Edit message with quantity selection
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: quantityButtons
      }
    });
    
    logger.info('Quantity selection displayed', { userId, collection });
  } catch (error) {
    logger.error('Error showing quantity selection', { error, userId, collection });
    await ctx.editMessageText('Sorry, there was an error fetching collection data. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', `sweep:collection:${collection}`)],
          [Markup.button.callback('🔙 Back to Collections', 'sweep:collection:select')]
        ]
      }
    });
  }
}

/**
 * Handle quantity selection
 * @param ctx Context
 * @param userId User ID
 * @param quantityStr Selected quantity as string
 */
async function handleQuantitySelection(ctx: any, userId: number, quantityStr: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const quantity = parseInt(quantityStr);
    
    if (isNaN(quantity) || quantity <= 0) {
      await ctx.reply('Invalid quantity. Please select a valid option.');
      return;
    }
    
    // Store selected quantity in session
    ctx.session.sweepQuantity = quantity;
    
    // Ask for max price
    await showMaxPriceInput(ctx, userId);
    
    logger.info('Quantity selected', { userId, quantity });
  } catch (error) {
    logger.error('Error handling quantity selection', { error, userId });
    await ctx.reply('Sorry, there was an error processing your quantity selection. Please try again later.');
  }
}

/**
 * Handle custom quantity input
 * @param ctx Context
 * @param userId User ID
 */
async function handleCustomQuantity(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const collection = ctx.session.sweepCollection;
    
    const message = `
🧹 *Enter Custom Quantity*

Collection: *${collectionNames[collection]}*

Please enter the number of Axies you want to sweep (1-100):
    `;
    
    // Edit message to ask for custom quantity
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Quantity Selection', `sweep:collection:${collection}`)]
        ]
      }
    });
    
    // Set session state to expect custom quantity input
    ctx.session.sweepAction = 'custom_quantity';
    
    // Set up listener for text messages
    // This is handled in the main bot file's message handler
    
    logger.info('Custom quantity input requested', { userId });
  } catch (error) {
    logger.error('Error handling custom quantity input', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show max price input prompt
 * @param ctx Context
 * @param userId User ID
 */
async function showMaxPriceInput(ctx: any, userId: number): Promise<void> {
  try {
    const collection = ctx.session.sweepCollection;
    const quantity = ctx.session.sweepQuantity;
    
    // Get collection stats for reference
    const stats = await marketplaceService.getCollectionStats(collection);
    
    const message = `
💰 *Set Maximum Price per Axie*

Collection: *${collectionNames[collection]}*
Quantity: *${quantity} Axies*

*Current Stats:*
• Floor Price: ${stats.floorPrice.toFixed(4)} RON
• Avg. of 10 cheapest: ${stats.avg10Price.toFixed(4)} RON

Would you like to set a maximum price per Axie?
If you don't set a maximum, the bot will buy the cheapest available Axies.
    `;
    
    // Create buttons for max price options
    const buttons = [
      [
        Markup.button.callback(`Floor (${stats.floorPrice.toFixed(4)} RON)`, `sweep:max_price:floor`),
        Markup.button.callback(`Avg10 (${stats.avg10Price.toFixed(4)} RON)`, `sweep:max_price:avg10`)
      ],
      [
        Markup.button.callback('Custom Max Price', 'sweep:max_price:custom'),
        Markup.button.callback('No Max (Buy Cheapest)', 'sweep:max_price:none')
      ],
      [
        Markup.button.callback('🔙 Back to Quantity', `sweep:collection:${collection}`)
      ]
    ];
    
    // Edit message with max price options
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    
    logger.info('Max price input displayed', { userId, collection, quantity });
  } catch (error) {
    logger.error('Error showing max price input', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Handle max price input
 * @param ctx Context
 * @param userId User ID
 */
async function handleMaxPriceInput(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const option = ctx.callbackQuery.data.split(':')[2];
    const collection = ctx.session.sweepCollection;
    
    if (option === 'custom') {
      // Ask for custom max price
      const message = `
💰 *Enter Custom Maximum Price*

Collection: *${collectionNames[collection]}*
Quantity: *${ctx.session.sweepQuantity} Axies*

Please enter the maximum price per Axie in RON:
      `;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔙 Back to Max Price Options', `sweep:quantity:${ctx.session.sweepQuantity}`)]
          ]
        }
      });
      
      // Set session state to expect custom max price input
      ctx.session.sweepAction = 'custom_max_price';
      
      logger.info('Custom max price input requested', { userId });
    } else if (option === 'floor' || option === 'avg10') {
      // Get collection stats
      const stats = await marketplaceService.getCollectionStats(collection);
      
      // Set max price based on option
      let maxPrice;
      if (option === 'floor') {
        maxPrice = stats.floorPrice;
      } else { // avg10
        maxPrice = stats.avg10Price;
      }
      
      // Store max price in session
      ctx.session.sweepMaxPrice = maxPrice;
      
      // Show sweep preview
      await showSweepPreview(ctx, userId);
      
      logger.info('Max price selected', { userId, option, maxPrice });
    } else if (option === 'none') {
      // No max price, set to undefined
      ctx.session.sweepMaxPrice = undefined;
      
      // Show sweep preview
      await showSweepPreview(ctx, userId);
      
      logger.info('No max price selected', { userId });
    }
  } catch (error) {
    logger.error('Error handling max price input', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show sweep preview
 * @param ctx Context
 * @param userId User ID
 */
async function showSweepPreview(ctx: any, userId: number): Promise<void> {
  try {
    // Get active wallet
    const wallet = await ctx.dbConnection('wallets')
      .where({ user_id: userId, is_active: true })
      .first();
    
    if (!wallet) {
      await ctx.editMessageText('You need to have an active wallet to sweep. Please set an active wallet first.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔑 Wallet Management', 'wallet:setup')],
            [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
          ]
        }
      });
      return;
    }
    
    // Show loading message
    await ctx.editMessageText('🔍 Generating sweep preview... Please wait.');
    
    // Get sweep options from session
    const collection = ctx.session.sweepCollection;
    const quantity = ctx.session.sweepQuantity;
    const maxPrice = ctx.session.sweepMaxPrice;
    
    // Create sweep options
    const sweepOptions: SweepOptions = {
      userId,
      walletId: wallet.id,
      collection,
      quantity,
      maxPrice
    };
    
    try {
      // Generate sweep preview
      const preview = await sweepService.generateSweepPreview(ctx.dbConnection, sweepOptions);
      
      // Store preview in session for confirmation
      ctx.session.sweepPreview = preview;
      
      // Get wallet balance
      const balances = await walletService.getTokenBalances(wallet.address);
      const ronBalance = parseFloat(balances.ron);
      
      // Create preview message
      let message = `
🧹 *Sweep Preview*

Collection: *${collectionNames[collection]}*
Wallet: *${wallet.name}* (${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)})
Balance: *${ronBalance.toFixed(4)} RON*

*Sweep Details:*
• Quantity: ${preview.quantity} Axies
• Average Price: ${preview.averagePrice.toFixed(4)} RON
• Total Cost: ${preview.totalCost.toFixed(4)} RON
• Estimated Gas: ${preview.estimatedGasCost.toFixed(4)} RON
• Total with Gas: ${preview.totalWithGas.toFixed(4)} RON

${preview.axiesToPurchase.length === 0 ? '⚠️ No Axies found matching your criteria!' : ''}
${ronBalance < preview.totalWithGas ? '⚠️ Insufficient balance for this sweep!' : ''}
      `;
      
      // Add Axie IDs if not too many
      if (preview.axiesToPurchase.length > 0 && preview.axiesToPurchase.length <= 10) {
        message += '\n*Axies to Purchase:*\n';
        preview.axiesToPurchase.forEach((axie, index) => {
          const price = axie.order?.currentPrice 
            ? (parseFloat(axie.order.currentPrice) / 1e18).toFixed(4) 
            : 'N/A';
          message += `${index + 1}. #${axie.id} (${axie.class}) - ${price} RON\n`;
        });
      } else if (preview.axiesToPurchase.length > 10) {
        message += `\n*Axies to Purchase:* ${preview.axiesToPurchase.length} Axies (too many to list)\n`;
      }
      
      // Create buttons based on preview results
      let buttons;
      
      if (preview.axiesToPurchase.length === 0) {
        // No Axies found
        buttons = [
          [
            Markup.button.callback('🔄 Change Quantity', `sweep:collection:${collection}`),
            Markup.button.callback('🔄 Change Collection', 'sweep:collection:select')
          ],
          [
            Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
          ]
        ];
      } else if (ronBalance < preview.totalWithGas) {
        // Insufficient balance
        buttons = [
          [
            Markup.button.callback('💰 Check Wallet Balance', 'wallet:balance'),
            Markup.button.callback('🔄 Change Quantity', `sweep:collection:${collection}`)
          ],
          [
            Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
          ]
        ];
      } else {
        // Ready to sweep
        buttons = [
          [
            Markup.button.callback('✅ Confirm Sweep', 'sweep:confirm'),
            Markup.button.callback('❌ Cancel', 'sweep:start')
          ],
          [
            Markup.button.callback('🔄 Change Quantity', `sweep:collection:${collection}`),
            Markup.button.callback('🔄 Change Collection', 'sweep:collection:select')
          ]
        ];
      }
      
      // Edit message with preview
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buttons
        }
      });
      
      logger.info('Sweep preview displayed', { userId, collection, quantity, maxPrice });
    } catch (error) {
      logger.error('Error generating sweep preview', { error, userId, collection, quantity });
      await ctx.editMessageText('Sorry, there was an error generating the sweep preview. Please try again later.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'sweep:preview')],
            [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error showing sweep preview', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Confirm sweep
 * @param ctx Context
 * @param userId User ID
 */
async function confirmSweep(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const preview = ctx.session.sweepPreview as SweepPreview;
    
    if (!preview) {
      await ctx.editMessageText('Sweep preview not found. Please start the sweep process again.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Start Again', 'sweep:start')]
          ]
        }
      });
      return;
    }
    
    // Get wallet details
    const wallet = await ctx.dbConnection('wallets')
      .where({ id: preview.axiesToPurchase[0].id, user_id: userId })
      .first();
    
    // Create confirmation message
    const message = `
⚠️ *Confirm Sweep Transaction* ⚠️

You are about to purchase *${preview.quantity} ${collectionNames[preview.collection]} Axies* for a total of *${preview.totalCost.toFixed(4)} RON* plus *${preview.estimatedGasCost.toFixed(4)} RON* in gas fees.

Total transaction value: *${preview.totalWithGas.toFixed(4)} RON*

This action cannot be undone. Are you sure you want to proceed?
    `;
    
    // Create confirmation buttons
    const buttons = [
      [
        Markup.button.callback('✅ Yes, Execute Sweep', 'sweep:execute'),
        Markup.button.callback('❌ No, Cancel', 'sweep:start')
      ]
    ];
    
    // Edit message with confirmation
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    
    logger.info('Sweep confirmation displayed', { userId, collection: preview.collection, quantity: preview.quantity });
  } catch (error) {
    logger.error('Error confirming sweep', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Execute sweep
 * @param ctx Context
 * @param userId User ID
 */
async function executeSweep(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const preview = ctx.session.sweepPreview as SweepPreview;
    
    if (!preview) {
      await ctx.editMessageText('Sweep preview not found. Please start the sweep process again.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Start Again', 'sweep:start')]
          ]
        }
      });
      return;
    }
    
    // Show executing message
    await ctx.editMessageText('🔄 Executing sweep transaction... Please wait, this may take a few minutes.');
    
    // Get sweep options from session
    const collection = ctx.session.sweepCollection;
    const quantity = ctx.session.sweepQuantity;
    const maxPrice = ctx.session.sweepMaxPrice;
    
    // Get wallet
    const wallet = await ctx.dbConnection('wallets')
      .where({ id: preview.axiesToPurchase[0].id, user_id: userId })
      .first();
    
    // Create sweep options
    const sweepOptions: SweepOptions = {
      userId,
      walletId: wallet.id,
      collection,
      quantity,
      maxPrice
    };
    
    try {
      // Execute sweep
      const result = await sweepService.executeSweep(ctx.dbConnection, sweepOptions);
      
      if (result.success) {
        // Success message
        const message = `
✅ *Sweep Executed Successfully!*

Collection: *${collectionNames[collection]}*
Quantity: *${result.purchasedAxies.length} Axies*
Total Spent: *${result.totalSpent.toFixed(4)} RON*
Gas Used: *${result.gasUsed?.toFixed(4) || 'Unknown'} RON*

Transaction Hash: \`${result.transaction?.txHash}\`

Use /history to view your transaction history.
        `;
        
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback('📊 View Details', `sweep:view_transaction:${result.transaction?.txHash}`),
                Markup.button.callback('🧹 New Sweep', 'sweep:start')
              ]
            ]
          }
        });
        
        // Monitor transaction in background
        sweepService.monitorTransaction(ctx.dbConnection, result.transaction!.txHash)
          .then(status => {
            if (status === 'confirmed') {
              ctx.reply(`✅ Your sweep transaction has been confirmed on the blockchain!`);
            } else {
              ctx.reply(`❌ Your sweep transaction failed on the blockchain. Please check the transaction details.`);
            }
          })
          .catch(error => {
            logger.error('Error monitoring transaction', { error, txHash: result.transaction?.txHash });
          });
        
        logger.info('Sweep executed successfully', {
          userId,
          collection,
          quantity: result.purchasedAxies.length,
          txHash: result.transaction?.txHash
        });
      } else {
        // Failure message
        const message = `
❌ *Sweep Execution Failed*

Collection: *${collectionNames[collection]}*
Quantity: *${quantity} Axies*

Error: ${result.error || 'Unknown error'}

Please try again later or with different parameters.
        `;
        
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.callback('🔄 Try Again', 'sweep:preview'),
                Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
              ]
            ]
          }
        });
        
        logger.error('Sweep execution failed', { userId, collection, quantity, error: result.error });
      }
    } catch (error) {
      logger.error('Error executing sweep', { error, userId, collection, quantity });
      await ctx.editMessageText('Sorry, there was an error executing the sweep. Please try again later.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'sweep:preview')],
            [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error executing sweep', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show collection statistics
 * @param ctx Context
 * @param userId User ID
 * @param collectionStr Collection string (or 'all' for all collections)
 */
async function showCollectionStats(ctx: any, userId: number, collectionStr: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    if (collectionStr === 'all') {
      await showAllCollectionStats(ctx, userId);
      return;
    }
    
    const collection = collectionStr as AxieCollection;
    
    // Show loading message
    await ctx.editMessageText('📊 Fetching collection statistics... Please wait.');
    
    try {
      // Get collection stats
      const stats = await marketplaceService.getCollectionStats(collection);
      
      // Get historical stats (7 days)
      const historicalStats = await marketplaceService.getHistoricalStats(ctx.dbConnection, collection, 7);
      
      // Create stats message
      let message = `
📊 *${collectionNames[collection]} Statistics*

*Current Prices:*
• Floor Price: ${stats.floorPrice.toFixed(4)} RON ($${stats.floorPriceUsd.toFixed(2)})
• Avg. of 10 cheapest: ${stats.avg10Price.toFixed(4)} RON
• Avg. of 50 cheapest: ${stats.avg50Price.toFixed(4)} RON
• Avg. of 100 cheapest: ${stats.avg100Price.toFixed(4)} RON
• Total Listed: ${stats.totalListed}
      `;
      
      // Add historical data if available
      if (historicalStats.length > 0) {
        message += '\n*Historical Floor Prices:*\n';
        
        // Show last 7 days or less if not enough data
        const days = Math.min(7, historicalStats.length);
        for (let i = 0; i < days; i++) {
          const stat = historicalStats[historicalStats.length - 1 - i];
          const date = new Date(stat.timestamp).toLocaleDateString();
          message += `• ${date}: ${stat.floorPrice.toFixed(4)} RON\n`;
        }
      }
      
      // Create buttons
      const buttons = [
        [
          Markup.button.callback('🧹 Sweep This Collection', `sweep:collection:${collection}`),
          Markup.button.callback('🔄 Refresh Stats', `sweep:stats:${collection}`)
        ],
        [
          Markup.button.callback('📊 All Collections', 'sweep:all_stats'),
          Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
        ]
      ];
      
      // Edit message with stats
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buttons
        }
      });
      
      logger.info('Collection stats displayed', { userId, collection });
    } catch (error) {
      logger.error('Error fetching collection stats', { error, userId, collection });
      await ctx.editMessageText('Sorry, there was an error fetching collection statistics. Please try again later.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', `sweep:stats:${collection}`)],
            [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error showing collection stats', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show statistics for all collections
 * @param ctx Context
 * @param userId User ID
 */
async function showAllCollectionStats(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Show loading message
    await ctx.editMessageText('📊 Fetching all collection statistics... Please wait.');
    
    try {
      // Get all collection stats
      const statsMap = await marketplaceService.getAllCollectionStats();
      
      // Create stats message
      let message = '📊 *All Collection Statistics*\n\n';
      
      // Format collection stats
      for (const [collection, stats] of statsMap.entries()) {
        const name = collectionNames[collection] || collection;
        message += `*${name}*\n`;
        message += `• Floor: ${stats.floorPrice.toFixed(4)} RON ($${stats.floorPriceUsd.toFixed(2)})\n`;
        message += `• Avg10: ${stats.avg10Price.toFixed(4)} RON\n`;
        message += `• Listed: ${stats.totalListed}\n\n`;
      }
      
      // Create collection buttons (2 per row)
      const collectionButtons = [];
      const collections = Object.values(AxieCollection);
      
      for (let i = 0; i < collections.length; i += 2) {
        const row = [];
        
        if (i < collections.length) {
          row.push(Markup.button.callback(
            collectionNames[collections[i]],
            `sweep:stats:${collections[i]}`
          ));
        }
        
        if (i + 1 < collections.length) {
          row.push(Markup.button.callback(
            collectionNames[collections[i + 1]],
            `sweep:stats:${collections[i + 1]}`
          ));
        }
        
        collectionButtons.push(row);
      }
      
      // Add refresh and back buttons
      collectionButtons.push([
        Markup.button.callback('🔄 Refresh All Stats', 'sweep:all_stats'),
        Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
      ]);
      
      // Edit message with stats
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: collectionButtons
        }
      });
      
      logger.info('All collection stats displayed', { userId });
    } catch (error) {
      logger.error('Error fetching all collection stats', { error, userId });
      await ctx.editMessageText('Sorry, there was an error fetching collection statistics. Please try again later.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'sweep:all_stats')],
            [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error showing all collection stats', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show sweep history
 * @param ctx Context
 * @param userId User ID
 */
async function showSweepHistory(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Show loading message
    await ctx.editMessageText('📜 Fetching sweep history... Please wait.');
    
    try {
      // Get transaction history (last 10 transactions)
      const transactions = await sweepService.getTransactionHistory(ctx.dbConnection, userId, 10);
      
      if (transactions.length === 0) {
        await ctx.editMessageText('You haven\'t made any sweep transactions yet.', {
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🧹 Start Sweeping', 'sweep:collection:select')],
              [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
            ]
          }
        });
        return;
      }
      
      // Create history message
      let message = '📜 *Your Sweep History*\n\n';
      
      // Format transactions
      transactions.forEach((tx, index) => {
        const date = new Date(tx.createdAt).toLocaleDateString();
        const time = new Date(tx.createdAt).toLocaleTimeString();
        const statusEmoji = tx.status === 'confirmed' ? '✅' : (tx.status === 'pending' ? '⏳' : '❌');
        
        message += `${index + 1}. ${statusEmoji} ${collectionNames[tx.collection as AxieCollection] || tx.collection}\n`;
        message += `   ${tx.axieIds.length} Axies, ${tx.totalAmount.toFixed(4)} RON\n`;
        message += `   ${date} ${time}\n\n`;
      });
      
      // Create transaction buttons (up to 5)
      const txButtons = [];
      const maxButtons = Math.min(5, transactions.length);
      
      for (let i = 0; i < maxButtons; i++) {
        txButtons.push([
          Markup.button.callback(
            `View #${i + 1}: ${collectionNames[transactions[i].collection as AxieCollection] || transactions[i].collection}`,
            `sweep:view_transaction:${transactions[i].txHash}`
          )
        ]);
      }
      
      // Add back button
      txButtons.push([
        Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
      ]);
      
      // Edit message with history
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: txButtons
        }
      });
      
      logger.info('Sweep history displayed', { userId, transactionCount: transactions.length });
    } catch (error) {
      logger.error('Error fetching sweep history', { error, userId });
      await ctx.editMessageText('Sorry, there was an error fetching your sweep history. Please try again later.', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'sweep:history')],
            [Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error showing sweep history', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
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
          Markup.button.callback('🔙 Back to History', 'sweep:history')
        ],
        [
          Markup.button.callback('🔙 Back to Sweep Menu', 'sweep:start')
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
            [Markup.button.callback('🔄 Try Again', `sweep:view_transaction:${txHash}`)],
            [Markup.button.callback('🔙 Back to History', 'sweep:history')]
          ]
        }
      });
    }
  } catch (error) {
    logger.error('Error viewing transaction details', { error, userId });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}
