// @ts-nocheck
import { Markup } from 'telegraf';
import Logger from '../../utils/logger';
import priceService from '../../services/priceService';
import MarketplaceService, { 
  AxieCollection, 
  AxieClass, 
  Axie, 
  AxieListingResponse 
} from '../../services/marketplaceService';
import config from '../../config';

// Initialize logger
const logger = new Logger('command:marketplace');

// Initialize marketplace service
const marketplaceService = new MarketplaceService();

// Default page size for listings
const PAGE_SIZE = 5;
// Number of Axies to display in collection view
const DISPLAY_SIZE = 10;

/**
 * Handle the /marketplace command
 * Shows marketplace browsing options
 */
export async function handleMarketplaceCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('Marketplace command received', { userId });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return;
    }
    
    // Create marketplace menu message
    const message = `
🛒 *Axie Infinity Marketplace*

Welcome to the marketplace browser! You can:

• Browse the latest Axie listings
• Browse Axies by collection

What would you like to do?
    `;
    
    // Create inline keyboard with marketplace options
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🆕 Latest Listings', 'marketplace:latest')
      ],
      [
        Markup.button.callback('🏆 Browse Collections', 'marketplace:collection')
      ],
      // Home navigation
      [
        Markup.button.callback('🏠 Back to Home', 'start:menu')
      ]
    ]);
    
    // Decide whether to edit an existing message (when invoked via callback)
    // or send a new one (normal /marketplace command)
    let sent = false;
    if (ctx.callbackQuery) {
      // Acknowledge callback to clear Telegram loading spinner
      await ctx.answerCbQuery();
      try {
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup
        });
        sent = true;
      } catch (err) {
        // Could fail if original message not editable (too old, etc.)
        logger.warn('Failed to edit marketplace menu message – sending new one', { err });
      }
    }

    // Fallback or normal flow: send a fresh message
    if (!sent) {
      await ctx.replyWithMarkdown(message, keyboard);
    }
    
    logger.info('Marketplace command completed', { userId });
  } catch (error) {
    logger.error('Error handling marketplace command', { error });
    await ctx.reply('Sorry, there was an error accessing the marketplace. Please try again later.');
  }
}

/**
 * Handle marketplace-related callbacks
 * @param ctx Context
 */
export async function handleMarketplaceCallback(ctx: any): Promise<void> {
  try {
    // Extract callback data and user information
    const callbackData = ctx.callbackQuery.data;
    const action = callbackData.split(':')[1];
    const userId = ctx.from?.id;
    
    logger.info('Marketplace callback received', { userId, action });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.answerCbQuery('Please start the bot with /start first.');
      return;
    }
    
    // Handle different marketplace actions
    switch (action) {
      // Explicit menu case so other modules (e.g. sweep/start buttons) can
      // jump directly to the main marketplace menu
      case 'menu':
        // Just call the same routine that /marketplace uses
        await handleMarketplaceCommand(ctx);
        break;
      case 'latest':
        await handleLatestAxies(ctx, user.id);
        break;
      case 'collection':
        await handleCollectionSelection(ctx, user.id);
        break;
      case 'view':
        await handleViewAxie(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'page':
        // Format: marketplace:page:{direction}:{type}:{page}:{additionalParams}
        const parts = callbackData.split(':');
        const direction = parts[2]; // next or prev
        const type = parts[3]; // latest, collection, class, etc.
        const page = parseInt(parts[4]);
        const additionalParams = parts.slice(5).join(':');
        await handlePagination(ctx, user.id, direction, type, page, additionalParams);
        break;
      case 'select_collection':
        await handleBrowseByCollection(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'add_to_sweep':
        await handleAddToSweep(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'sweep':
        const sweepAmount = callbackData.split(':')[2];
        const collection = callbackData.split(':')[3];
        await handleSweepAction(ctx, user.id, sweepAmount, collection);
        break;
      case 'back':
        // Go back to marketplace menu
        await handleMarketplaceCommand(ctx);
        break;
      default:
        await ctx.answerCbQuery('Unknown action');
        break;
    }
    
    logger.info('Marketplace callback completed', { userId, action });
  } catch (error) {
    logger.error('Error handling marketplace callback', { error });
    await ctx.answerCbQuery('An error occurred. Please try again.');
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Handle browsing latest Axies
 * @param ctx Context
 * @param userId User ID
 */
async function handleLatestAxies(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery('Loading latest Axies...');
    
    // Show loading message
    await ctx.editMessageText('🔍 Searching for the latest Axies on the marketplace...');
    
    // Get latest Axies
    const axies = await marketplaceService.getAxieLatest({
      from: 0,
      size: PAGE_SIZE,
      sort: 'Latest',
      auctionType: 'Sale'
    });
    
    // Display results
    await displayAxieListings(ctx, axies, 'latest', 0);
    
    logger.info('Latest Axies displayed', { userId });
  } catch (error) {
    logger.error('Error fetching latest Axies', { error, userId });
    await ctx.editMessageText('Sorry, there was an error fetching the latest Axies. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Marketplace', callback_data: 'marketplace:back' }]
        ]
      }
    });
  }
}

/**
 * Handle collection selection
 * @param ctx Context
 * @param userId User ID
 */
async function handleCollectionSelection(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCbQuery();
    
    const message = `
🏆 *Browse by Collection*

Select an Axie collection to browse:
    `;
    
    // Create collection selection buttons
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🌟 Origin', `marketplace:select_collection:${AxieCollection.ORIGIN}`),
        Markup.button.callback('🌠 Origin Gen 0', `marketplace:select_collection:${AxieCollection.ORIGIN_GEN0}`)
      ],
      [
        Markup.button.callback('✨ Mystic', `marketplace:select_collection:${AxieCollection.MYSTIC}`),
        Markup.button.callback('💎 MEO Corp', `marketplace:select_collection:${AxieCollection.MEO_CORP}`)
      ],
      [
        // Newly-added MEO Corp II button
        Markup.button.callback('💎 MEO Corp II', `marketplace:select_collection:${AxieCollection.MEO_CORP_II}`)
      ],
      [
        Markup.button.callback('🌞 Summer 2022', `marketplace:select_collection:${AxieCollection.SUMMER_2022}`),
        Markup.button.callback('🎄 Christmas', `marketplace:select_collection:${AxieCollection.CHRISTMAS}`)
      ],
      [
        Markup.button.callback('🌙 Nightmare', `marketplace:select_collection:${AxieCollection.NIGHTMARE}`),
        Markup.button.callback('🌸 Japanese', `marketplace:select_collection:${AxieCollection.JAPANESE}`)
      ],
      [
        Markup.button.callback('⚡ Shiny', `marketplace:select_collection:${AxieCollection.SHINY}`),
        Markup.button.callback('🐣 Regular', `marketplace:select_collection:${AxieCollection.REGULAR}`)
      ],
      [
        Markup.button.callback('🔙 Back to Marketplace', 'marketplace:back')
      ]
    ]);
    
    // Edit message with collection selection
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
    logger.info('Collection selection displayed', { userId });
  } catch (error) {
    logger.error('Error displaying collection selection', { error, userId });
    await ctx.editMessageText('Sorry, there was an error displaying collections. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Marketplace', callback_data: 'marketplace:back' }]
        ]
      }
    });
  }
}

/**
 * Handle browsing Axies by collection
 * @param ctx Context
 * @param userId User ID
 * @param collection Collection type
 */
async function handleBrowseByCollection(ctx: any, userId: number, collection: AxieCollection): Promise<void> {
  try {
    await ctx.answerCbQuery(`Loading ${collection} Axies...`);
    
    // Show loading message
    await ctx.editMessageText(`🔍 Searching for ${collection} Axies on the marketplace...`);

    // Get Axies by collection - fetch 50 for statistics but display fewer
    const axies = await marketplaceService.getAxiesByCollection(collection, {
      from: 0,
      size: 50, // Fetch 50 Axies for statistics
      sort: 'PriceAsc',
      auctionType: 'Sale'
    });
    
    // Display results
    await displayAxieListings(ctx, axies, 'collection', 0, collection);
    
    logger.info('Collection Axies displayed', { userId, collection });
  } catch (error) {
    logger.error('Error fetching collection Axies', { error, userId, collection });
    await ctx.editMessageText(`Sorry, there was an error fetching ${collection} Axies. Please try again later.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Collections', callback_data: 'marketplace:collection' }]
        ]
      }
    });
  }
}

/**
 * Handle viewing a specific Axie
 * @param ctx Context
 * @param userId User ID
 * @param axieId Axie ID
 */
async function handleViewAxie(ctx: any, userId: number, axieId: string): Promise<void> {
  try {
    await ctx.answerCbQuery(`Loading Axie #${axieId}...`);
    
    // Show loading message
    await ctx.editMessageText(`🔍 Loading details for Axie #${axieId}...`);
    
    // Get Axie details
    const axie = await marketplaceService.getAxieDetails(axieId);
    
    // Format Axie details for display
    const message = await formatAxieDetails(axie);
    
    // Create action buttons
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.url('View on Marketplace', `https://marketplace.axieinfinity.com/axie/${axieId}`),
        Markup.button.callback('➕ Add to Sweep', `marketplace:add_to_sweep:${axieId}`)
      ],
      [
        Markup.button.callback('🔙 Back to Results', 'marketplace:back')
      ]
    ]);
    
    // Edit message with Axie details
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
      ...keyboard
    });
    
    logger.info('Axie details displayed', { userId, axieId });
  } catch (error) {
    logger.error('Error fetching Axie details', { error, userId, axieId });
    await ctx.editMessageText(`Sorry, there was an error fetching details for Axie #${axieId}. Please try again later.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Marketplace', callback_data: 'marketplace:back' }]
        ]
      }
    });
  }
}

/**
 * Handle adding an Axie to the sweep list
 * @param ctx Context
 * @param userId User ID
 * @param axieId Axie ID
 */
async function handleAddToSweep(ctx: any, userId: number, axieId: string): Promise<void> {
  try {
    await ctx.answerCbQuery(`Adding Axie #${axieId} to sweep list...`);
    
    // In a real implementation, you would add the Axie to the user's sweep list
    // For now, we'll just show a message
    
    await ctx.reply(`Axie #${axieId} has been added to your sweep list.`);
    
    logger.info('Axie added to sweep list', { userId, axieId });
  } catch (error) {
    logger.error('Error adding Axie to sweep list', { error, userId, axieId });
    await ctx.reply(`Sorry, there was an error adding Axie #${axieId} to your sweep list. Please try again later.`);
  }
}

/**
 * Handle sweep action
 * @param ctx Context
 * @param userId User ID
 * @param amount Amount to sweep (number or 'custom')
 * @param collection Collection to sweep
 */
async function handleSweepAction(
  ctx: any,
  userId: number,
  amount: string,
  collection: string
): Promise<void> {
  try {
    // If custom amount, prompt user to enter a number
    if (amount === 'custom') {
      await ctx.answerCbQuery();
      
      // Set session state for custom sweep
      ctx.session.marketplaceAction = 'custom_sweep';
      ctx.session.sweepCollection = collection;
      
      const message = `
🧹 *Custom Sweep Amount*

Please enter the number of Axies you want to sweep from the ${collection} collection:
      `;
      
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancel', callback_data: `marketplace:select_collection:${collection}` }]
          ]
        }
      });
      
      return;
    }
    
    // For numeric amounts, proceed with sweep
    const numAmount = parseInt(amount);
    await ctx.answerCbQuery(`Preparing to sweep ${numAmount} Axies...`);
    
    // Store sweep parameters in session
    ctx.session.sweepCollection = collection;
    ctx.session.sweepQuantity = numAmount;
    
    // No need to set max price - the sweep preview will use the default (no max)
    ctx.session.sweepMaxPrice = undefined;
    
    // Trigger the sweep preview by simulating a callback to sweep:preview
    // This will use the parameters we just stored in the session
    ctx.callbackQuery.data = 'sweep:preview';
    
    // Forward to the sweep preview handler
    await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);
    await ctx.reply(`🧹 Preparing sweep preview for ${numAmount} ${collection} Axies...`);
    
    // Call the sweep preview handler
    const { handleSweepCallback } = require('./sweep');
    await handleSweepCallback(ctx);
    
    logger.info('Sweep action initiated', { userId, amount: numAmount, collection });
  } catch (error) {
    logger.error('Error handling sweep action', { error, userId, amount, collection });
    await ctx.editMessageText('Sorry, there was an error preparing the sweep. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Marketplace', callback_data: 'marketplace:back' }]
        ]
      }
    });
  }
}

/**
 * Handle pagination for Axie listings
 * @param ctx Context
 * @param userId User ID
 * @param direction Pagination direction (next or prev)
 * @param type Listing type (latest, collection, class, etc.)
 * @param page Current page
 * @param additionalParams Additional parameters (collection, class, etc.)
 */
async function handlePagination(
  ctx: any,
  userId: number,
  direction: string,
  type: string,
  page: number,
  additionalParams: string
): Promise<void> {
  try {
    await ctx.answerCbQuery('Loading...');
    
    // Calculate new page
    const newPage = direction === 'next' ? page + 1 : Math.max(0, page - 1);
    
    // Show loading message
    await ctx.editMessageText('Loading more Axies...');
    
    let axies: AxieListingResponse;
    
    // Fetch Axies based on type
    switch (type) {
      case 'latest':
        axies = await marketplaceService.getAxieLatest({
          from: newPage * PAGE_SIZE,
          size: PAGE_SIZE,
          sort: 'Latest',
          auctionType: 'Sale'
        });
        break;
      case 'collection':
        axies = await marketplaceService.getAxiesByCollection(additionalParams as AxieCollection, {
          from: newPage * PAGE_SIZE,
          size: PAGE_SIZE,
          sort: 'PriceAsc',
          auctionType: 'Sale'
        });
        break;
      default:
        throw new Error(`Unknown listing type: ${type}`);
    }
    
    // Display results
    await displayAxieListings(ctx, axies, type, newPage, additionalParams);
    
    logger.info('Pagination handled', { userId, direction, type, page: newPage });
  } catch (error) {
    logger.error('Error handling pagination', { error, userId, direction, type, page });
    await ctx.editMessageText('Sorry, there was an error loading more Axies. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Marketplace', callback_data: 'marketplace:back' }]
        ]
      }
    });
  }
}

/**
 * Calculate average price for a subset of Axies
 * @param axies Array of Axies
 * @param count Number of Axies to include in average
 * @returns Average price in ETH
 */
function calculateAveragePrice(axies: Axie[], count: number): number {
  if (!axies || axies.length === 0 || count <= 0) return 0;
  
  const axiesWithPrice = axies
    .filter(axie => axie.order?.currentPrice)
    .slice(0, Math.min(count, axies.length));
  
  if (axiesWithPrice.length === 0) return 0;
  
  const sum = axiesWithPrice.reduce((total, axie) => {
    return total + parseFloat(axie.order.currentPrice) / 1e18;
  }, 0);
  
  return sum / axiesWithPrice.length;
}

/**
 * Display Axie listings with pagination
 * @param ctx Context
 * @param axies Axie listing response
 * @param type Listing type (latest, collection, class, etc.)
 * @param page Current page
 * @param additionalParams Additional parameters (collection, class, etc.)
 */
async function displayAxieListings(
  ctx: any,
  axies: AxieListingResponse,
  type: string,
  page: number,
  additionalParams: string = ''
): Promise<void> {
  // Create title based on type
  let title = '🛒 *Axie Marketplace*\n\n';
  
  switch (type) {
    case 'latest':
      title += '🆕 *Latest Listings*\n\n';
      break;
    case 'collection':
      title += `🏆 *${additionalParams} Collection*\n\n`;
      break;
  }
  
  // Add collection insights if we're browsing a collection
  if (type === 'collection' && axies.results.length > 0) {
    // Calculate statistics
    const axiesWithPrice = axies.results.filter(axie => axie.order?.currentPrice);
    
    if (axiesWithPrice.length > 0) {
      // Sort by price for calculations
      const sortedAxies = [...axiesWithPrice].sort((a, b) => {
        const priceA = parseFloat(a.order.currentPrice) / 1e18;
        const priceB = parseFloat(b.order.currentPrice) / 1e18;
        return priceA - priceB;
      });
      
      // Calculate lowest and highest prices
      const lowestPrice = parseFloat(sortedAxies[0].order.currentPrice) / 1e18;
      const highestPrice = parseFloat(sortedAxies[sortedAxies.length - 1].order.currentPrice) / 1e18;
      
      // Calculate average prices
      const avg5 = calculateAveragePrice(sortedAxies, 5);
      const avg10 = calculateAveragePrice(sortedAxies, 10);
      const avg20 = calculateAveragePrice(sortedAxies, 20);
      const avg50 = calculateAveragePrice(sortedAxies, 50);
      
      // Get USD prices
      const lowestUsd = await priceService.ethToUsd(lowestPrice);
      const highestUsd = await priceService.ethToUsd(highestPrice);
      const avg5Usd = await priceService.ethToUsd(avg5);
      const avg10Usd = await priceService.ethToUsd(avg10);
      const avg20Usd = await priceService.ethToUsd(avg20);
      const avg50Usd = await priceService.ethToUsd(avg50);
      
      // Add collection insights to title
      title += `📊 *Collection Insights*\n`;
      title += `• Total Listed: ${axies.total}\n`;
      title += `• Lowest Price: ${lowestPrice.toFixed(7)} ETH ($${lowestUsd.toFixed(2)})\n`;
      title += `• Highest Price: ${highestPrice.toFixed(7)} ETH ($${highestUsd.toFixed(2)})\n`;
      title += `• Avg Price (5): ${avg5.toFixed(7)} ETH ($${avg5Usd.toFixed(2)})\n`;
      title += `• Avg Price (10): ${avg10.toFixed(7)} ETH ($${avg10Usd.toFixed(2)})\n`;
      title += `• Avg Price (20): ${avg20.toFixed(7)} ETH ($${avg20Usd.toFixed(2)})\n`;
      title += `• Avg Price (50): ${avg50.toFixed(7)} ETH ($${avg50Usd.toFixed(2)})\n\n`;
    }
  }
  
  // Add result count
  title += `Found ${axies.total} Axies. Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, axies.total)}:\n\n`;
  
  // Format each Axie
  let message = title;
  
  if (axies.results.length === 0) {
    message += 'No Axies found matching your criteria.';
  } else {
    // Limit display to 10 Axies for collection view
    const displayResults = type === 'collection' 
      ? axies.results.slice(0, DISPLAY_SIZE) 
      : axies.results;
    
    // Use for loop instead of forEach to handle async calls
    for (let i = 0; i < displayResults.length; i++) {
      const axie = displayResults[i];
      const formattedListing = await formatAxieListing(axie, i + 1 + page * PAGE_SIZE);
      message += formattedListing;
    }
  }
  
  // Create keyboard with buttons
  const keyboard = [];
  
  // Add sweep buttons (only for collection view)
  if (type === 'collection' && axies.results.length > 0) {
    /* --------------------------------------------------------------
     * Row 1: Sweep 2 | Sweep 5
     * Row 2: Sweep 10 | Sweep 20
     * Row 3: Custom Amount
     * ------------------------------------------------------------ */
    keyboard.push([
      Markup.button.callback('🧹 Sweep 2', `marketplace:sweep:2:${additionalParams}`),
      Markup.button.callback('🧹 Sweep 5', `marketplace:sweep:5:${additionalParams}`)
    ]);
    keyboard.push([
      Markup.button.callback('🧹 Sweep 10', `marketplace:sweep:10:${additionalParams}`),
      Markup.button.callback('🧹 Sweep 20', `marketplace:sweep:20:${additionalParams}`)
    ]);
    keyboard.push([
      Markup.button.callback('🧹 Custom Amount', `marketplace:sweep:custom:${additionalParams}`)
    ]);
  }
  
  // Create pagination buttons
  const paginationRow = [];
  
  // Previous page button (if not on first page)
  if (page > 0) {
    paginationRow.push(
      Markup.button.callback('⬅️ Previous', `marketplace:page:prev:${type}:${page}:${additionalParams}`)
    );
  }
  
  // Next page button (if more results available)
  if ((page + 1) * PAGE_SIZE < axies.total) {
    paginationRow.push(
      Markup.button.callback('Next ➡️', `marketplace:page:next:${type}:${page}:${additionalParams}`)
    );
  }
  
  // Add pagination buttons if any exist
  if (paginationRow.length > 0) {
    keyboard.push(paginationRow);
  }
  
  // Add back button
  switch (type) {
    case 'collection':
      keyboard.push([Markup.button.callback('🔙 Back to Collections', 'marketplace:collection')]);
      break;
    default:
      keyboard.push([Markup.button.callback('🔙 Back to Marketplace', 'marketplace:back')]);
  }
  
  // Edit message with Axie listings and buttons
  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

/**
 * Format Axie listing for display
 * @param axie Axie
 * @param index Index in the list
 * @returns Formatted Axie listing
 */
async function formatAxieListing(axie: Axie, index: number): Promise<string> {
  // Format price
  let priceDisplay = 'Not for sale';
  if (axie.order?.currentPrice) {
    // Convert wei to ETH
    const ethPrice = parseFloat(axie.order.currentPrice) / 1e18;
    // Fetch real USD value
    const usdPrice = await priceService.ethToUsd(ethPrice);
    priceDisplay = `${ethPrice.toFixed(7)} ETH ($${usdPrice.toFixed(2)})`;
  }
  
  // Create simplified listing string with plain text (no markdown link)
  return `*${index}. Axie #${axie.id} - ${axie.name}*\nPrice: ${priceDisplay}\n\n`;
}

/**
 * Format detailed Axie information
 * @param axie Axie
 * @returns Formatted Axie details
 */
async function formatAxieDetails(axie: Axie): Promise<string> {
  // Format price
  let priceDisplay = 'Not for sale';
  if (axie.order?.currentPrice) {
    // Convert wei to ETH
    const ethPrice = parseFloat(axie.order.currentPrice) / 1e18;
    const usdPrice = await priceService.ethToUsd(ethPrice);
    priceDisplay = `${ethPrice.toFixed(7)} ETH ($${usdPrice.toFixed(2)})`;
  }
  
  // Format seller address
  const seller = axie.order?.seller 
    ? `${axie.order.seller.substring(0, 6)}...${axie.order.seller.substring(axie.order.seller.length - 4)}` 
    : 'Unknown';
  
  // Format parts
  const parts = axie.parts.map(part => `• ${part.type}: ${part.name} (${part.class})`).join('\n');
  
  // Format collection badge
  let collectionBadge = '';
  switch (axie.collection) {
    case AxieCollection.ORIGIN_GEN0:
      collectionBadge = '🌠 Origin Gen 0';
      break;
    case AxieCollection.ORIGIN:
      collectionBadge = '🌟 Origin';
      break;
    case AxieCollection.MYSTIC:
      collectionBadge = '✨ Mystic';
      break;
    case AxieCollection.MEO_CORP:
      collectionBadge = '💎 MEO Corp';
      break;
    case AxieCollection.MEO_CORP_II:
      collectionBadge = '💎 MEO Corp II';
      break;
    case AxieCollection.SUMMER_2022:
      collectionBadge = '🌞 Summer 2022';
      break;
    case AxieCollection.CHRISTMAS:
      collectionBadge = '🎄 Christmas';
      break;
    case AxieCollection.NIGHTMARE:
      collectionBadge = '🌙 Nightmare';
      break;
    case AxieCollection.JAPANESE:
      collectionBadge = '🌸 Japanese';
      break;
    case AxieCollection.SHINY:
      collectionBadge = '⚡ Shiny';
      break;
    default:
      collectionBadge = '🐣 Regular';
  }
  
  // Create details string
  return `
🔍 *Axie #${axie.id}* - ${axie.name}
${collectionBadge}

[View Image](${axie.image})

*Basic Information:*
• Class: ${axie.class}
• Breed Count: ${axie.breedCount}/7
• Price: ${priceDisplay}
• Seller: ${seller}

*Parts:*
${parts}

*Marketplace Information:*
• Collection: ${axie.collection}
• Stage: ${axie.stage}
${axie.title ? `• Title: ${axie.title}` : ''}
  `;
}

/**
 * Process text messages for marketplace actions
 * @param ctx Context
 */
export async function processMarketplaceMessage(ctx: any): Promise<boolean> {
  // Check if we're expecting a marketplace-related message
  if (!ctx.session.marketplaceAction) {
    return false;
  }
  
  const action = ctx.session.marketplaceAction;
  const userId = ctx.from?.id;
  
  try {
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return true;
    }
    
    // Handle different marketplace actions
    switch (action) {
      case 'custom_sweep':
        // Extract sweep amount from message
        const sweepAmount = ctx.message.text.trim();
        const collection = ctx.session.sweepCollection;
        
        // Validate sweep amount
        if (!/^\d+$/.test(sweepAmount) || parseInt(sweepAmount) <= 0) {
          await ctx.reply('Please enter a valid number greater than 0.');
          return true;
        }
        
        // Clear session state
        ctx.session.marketplaceAction = null;
        
        // Store sweep parameters in session (don't clear sweepCollection)
        ctx.session.sweepQuantity = parseInt(sweepAmount);
        
        // No need to set max price - the sweep preview will use the default (no max)
        ctx.session.sweepMaxPrice = undefined;
        
        // Show loading message
        await ctx.reply(`🧹 Preparing to sweep ${sweepAmount} Axies from the ${collection} collection...`);
        
        try {
          // Create a fake callback query to trigger the sweep preview
          const fakeCtx = {...ctx};
          fakeCtx.callbackQuery = {
            id: Date.now().toString(),
            data: 'sweep:preview'
          };
          
          // Call the sweep preview handler
          const { handleSweepCallback } = require('./sweep');
          await handleSweepCallback(fakeCtx);
          
          logger.info('Custom sweep initiated', { userId, amount: sweepAmount, collection });
        } catch (error) {
          logger.error('Error initiating custom sweep', { error, userId, amount: sweepAmount, collection });
          await ctx.reply('Sorry, there was an error preparing the sweep. Please try again later.', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to Marketplace', callback_data: 'marketplace:back' }]
              ]
            }
          });
        }
        return true;
    }
    
    return true;
  } catch (error) {
    logger.error('Error processing marketplace message', { error, userId, action });
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
    
    // Clear session state
    ctx.session.marketplaceAction = null;
    
    return true;
  }
}
