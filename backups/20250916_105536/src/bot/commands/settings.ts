import { Markup } from 'telegraf';
import { Context } from 'telegraf';
import Logger from '../../utils/logger';
import config from '../../config';

// Initialize logger
const logger = new Logger('command:settings');

// Default settings values
const DEFAULT_MAX_SWEEP_QUANTITY = 20;
const DEFAULT_DAILY_LIMIT = 10;
const DEFAULT_NOTIFICATION_ENABLED = true;

// Interface for user settings
interface UserSettings {
  userId: number;
  maxSweepQuantity: number;
  dailyLimit: number;
  notificationEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Handle the /settings command
 * Shows settings management options
 */
export async function handleSettingsCommand(ctx: any): Promise<void> {
  try {
    // Extract user information
    const userId = ctx.from?.id;
    
    logger.info('Settings command received', { userId });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return;
    }
    
    // Show settings menu
    await showSettingsMenu(ctx, user.id);
    
    logger.info('Settings command completed', { userId });
  } catch (error) {
    logger.error('Error handling settings command', { error });
    await ctx.reply('Sorry, there was an error accessing your settings. Please try again later.');
  }
}

/**
 * Handle settings-related callbacks
 * @param ctx Context
 */
export async function handleSettingsCallback(ctx: any): Promise<void> {
  try {
    // Extract callback data and user information
    const callbackData = ctx.callbackQuery.data;
    const action = callbackData.split(':')[1];
    const userId = ctx.from?.id;
    
    logger.info('Settings callback received', { userId, action });
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.answerCallbackQuery('Please start the bot with /start first.');
      return;
    }
    
    // Handle different settings actions
    switch (action) {
      case 'menu':
        await showSettingsMenu(ctx, user.id);
        break;
      case 'sweep_limit':
        await handleSweepLimitSetting(ctx, user.id);
        break;
      case 'daily_limit':
        await handleDailyLimitSetting(ctx, user.id);
        break;
      case 'notifications':
        await handleNotificationSetting(ctx, user.id);
        break;
      case 'set_sweep_limit':
        await updateSweepLimit(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'set_daily_limit':
        await updateDailyLimit(ctx, user.id, callbackData.split(':')[2]);
        break;
      case 'toggle_notifications':
        await toggleNotifications(ctx, user.id);
        break;
      case 'custom_sweep_limit':
        await promptCustomSweepLimit(ctx, user.id);
        break;
      case 'custom_daily_limit':
        await promptCustomDailyLimit(ctx, user.id);
        break;
      case 'reset_defaults':
        await resetToDefaults(ctx, user.id);
        break;
      default:
        await ctx.answerCallbackQuery('Unknown action');
        break;
    }
    
    logger.info('Settings callback completed', { userId, action });
  } catch (error) {
    logger.error('Error handling settings callback', { error });
    await ctx.answerCallbackQuery('An error occurred. Please try again.');
    await ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Show the settings menu
 * @param ctx Context
 * @param userId User ID
 */
async function showSettingsMenu(ctx: any, userId: number): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
    
    // Get user settings
    const settings = await getUserSettings(ctx.dbConnection, userId);
    
    // Create settings message
    const message = `
⚙️ *Bot Settings*

Configure your preferences for the Axie Marketplace Sweep Bot:

*Current Settings:*
• Max Sweep Quantity: ${settings.maxSweepQuantity} Axies
• Daily Transaction Limit: ${settings.dailyLimit} RON
• Notifications: ${settings.notificationEnabled ? 'Enabled ✅' : 'Disabled ❌'}

Select a setting to change:
    `;
    
    // Create settings buttons
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔢 Max Sweep Quantity', 'settings:sweep_limit'),
        Markup.button.callback('💰 Daily Limit', 'settings:daily_limit')
      ],
      [
        Markup.button.callback(`🔔 Notifications: ${settings.notificationEnabled ? 'ON' : 'OFF'}`, 'settings:notifications')
      ],
      [
        Markup.button.callback('🔄 Reset to Defaults', 'settings:reset_defaults')
      ],
      [
        Markup.button.callback('🔙 Back to Main Menu', 'start')
      ]
    ]);
    
    // Send or edit message
    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    } else {
      await ctx.replyWithMarkdown(message, keyboard);
    }
    
    logger.info('Settings menu displayed', { userId });
  } catch (error) {
    logger.error('Error showing settings menu', { error, userId });
    
    const errorMessage = 'Sorry, there was an error retrieving your settings. Please try again later.';
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(errorMessage, {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'settings:menu')],
            [Markup.button.callback('🔙 Back to Main Menu', 'start')]
          ]
        }
      });
    } else {
      await ctx.reply(errorMessage, {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'settings:menu')],
            [Markup.button.callback('🔙 Back to Main Menu', 'start')]
          ]
        }
      });
    }
  }
}

/**
 * Handle sweep limit setting
 * @param ctx Context
 * @param userId User ID
 */
async function handleSweepLimitSetting(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get user settings
    const settings = await getUserSettings(ctx.dbConnection, userId);
    
    // Create message
    const message = `
🔢 *Max Sweep Quantity Setting*

This setting controls the maximum number of Axies you can purchase in a single sweep operation.

Current value: *${settings.maxSweepQuantity} Axies*
Default value: ${DEFAULT_MAX_SWEEP_QUANTITY} Axies
Maximum allowed: ${config.security.maxSweepQuantity} Axies

Select a new value or enter a custom amount:
    `;
    
    // Create buttons for common values
    const buttons = [
      [
        Markup.button.callback('5 Axies', 'settings:set_sweep_limit:5'),
        Markup.button.callback('10 Axies', 'settings:set_sweep_limit:10'),
        Markup.button.callback('20 Axies', 'settings:set_sweep_limit:20')
      ],
      [
        Markup.button.callback('50 Axies', 'settings:set_sweep_limit:50'),
        Markup.button.callback('100 Axies', 'settings:set_sweep_limit:100')
      ],
      [
        Markup.button.callback('Custom Amount', 'settings:custom_sweep_limit')
      ],
      [
        Markup.button.callback('🔙 Back to Settings', 'settings:menu')
      ]
    ];
    
    // Edit message with options
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    
    logger.info('Sweep limit setting displayed', { userId });
  } catch (error) {
    logger.error('Error handling sweep limit setting', { error, userId });
    await ctx.editMessageText('Sorry, there was an error retrieving your settings. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:sweep_limit')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Handle daily limit setting
 * @param ctx Context
 * @param userId User ID
 */
async function handleDailyLimitSetting(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get user settings
    const settings = await getUserSettings(ctx.dbConnection, userId);
    
    // Create message
    const message = `
💰 *Daily Transaction Limit Setting*

This setting controls the maximum amount of RON you can spend on sweeps per day.

Current value: *${settings.dailyLimit} RON*
Default value: ${DEFAULT_DAILY_LIMIT} RON
Maximum allowed: ${config.security.maxDailyTransactionAmount} RON

Select a new value or enter a custom amount:
    `;
    
    // Create buttons for common values
    const buttons = [
      [
        Markup.button.callback('5 RON', 'settings:set_daily_limit:5'),
        Markup.button.callback('10 RON', 'settings:set_daily_limit:10'),
        Markup.button.callback('25 RON', 'settings:set_daily_limit:25')
      ],
      [
        Markup.button.callback('50 RON', 'settings:set_daily_limit:50'),
        Markup.button.callback('100 RON', 'settings:set_daily_limit:100')
      ],
      [
        Markup.button.callback('Custom Amount', 'settings:custom_daily_limit')
      ],
      [
        Markup.button.callback('🔙 Back to Settings', 'settings:menu')
      ]
    ];
    
    // Edit message with options
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    
    logger.info('Daily limit setting displayed', { userId });
  } catch (error) {
    logger.error('Error handling daily limit setting', { error, userId });
    await ctx.editMessageText('Sorry, there was an error retrieving your settings. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:daily_limit')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Handle notification setting
 * @param ctx Context
 * @param userId User ID
 */
async function handleNotificationSetting(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get user settings
    const settings = await getUserSettings(ctx.dbConnection, userId);
    
    // Create message
    const message = `
🔔 *Notification Settings*

This setting controls whether you receive notifications about your sweep transactions.

Current status: *${settings.notificationEnabled ? 'Enabled ✅' : 'Disabled ❌'}*

Notifications include:
• Transaction confirmations
• Price alerts (coming soon)
• Sweep completion notifications
    `;
    
    // Create buttons
    const buttons = [
      [
        Markup.button.callback(
          settings.notificationEnabled ? 'Disable Notifications' : 'Enable Notifications',
          'settings:toggle_notifications'
        )
      ],
      [
        Markup.button.callback('🔙 Back to Settings', 'settings:menu')
      ]
    ];
    
    // Edit message with options
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    
    logger.info('Notification setting displayed', { userId });
  } catch (error) {
    logger.error('Error handling notification setting', { error, userId });
    await ctx.editMessageText('Sorry, there was an error retrieving your settings. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:notifications')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Update sweep limit
 * @param ctx Context
 * @param userId User ID
 * @param limitStr Limit as string
 */
async function updateSweepLimit(ctx: any, userId: number, limitStr: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const limit = parseInt(limitStr);
    
    if (isNaN(limit) || limit <= 0) {
      await ctx.reply('Invalid limit. Please select a valid option.');
      return;
    }
    
    // Check against maximum allowed
    const maxAllowed = config.security.maxSweepQuantity;
    const finalLimit = Math.min(limit, maxAllowed);
    
    // Update user settings
    await updateUserSettings(ctx.dbConnection, userId, { maxSweepQuantity: finalLimit });
    
    // Show success message
    await ctx.editMessageText(
      `✅ Max sweep quantity updated to *${finalLimit} Axies*${finalLimit < limit ? ` (limited by system maximum of ${maxAllowed})` : ''}.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
          ]
        }
      }
    );
    
    logger.info('Sweep limit updated', { userId, limit: finalLimit });
  } catch (error) {
    logger.error('Error updating sweep limit', { error, userId, limit: limitStr });
    await ctx.editMessageText('Sorry, there was an error updating your settings. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:sweep_limit')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Update daily limit
 * @param ctx Context
 * @param userId User ID
 * @param limitStr Limit as string
 */
async function updateDailyLimit(ctx: any, userId: number, limitStr: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    const limit = parseFloat(limitStr);
    
    if (isNaN(limit) || limit <= 0) {
      await ctx.reply('Invalid limit. Please select a valid option.');
      return;
    }
    
    // Check against maximum allowed
    const maxAllowed = config.security.maxDailyTransactionAmount;
    const finalLimit = Math.min(limit, maxAllowed);
    
    // Update user settings
    await updateUserSettings(ctx.dbConnection, userId, { dailyLimit: finalLimit });
    
    // Show success message
    await ctx.editMessageText(
      `✅ Daily transaction limit updated to *${finalLimit} RON*${finalLimit < limit ? ` (limited by system maximum of ${maxAllowed})` : ''}.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
          ]
        }
      }
    );
    
    logger.info('Daily limit updated', { userId, limit: finalLimit });
  } catch (error) {
    logger.error('Error updating daily limit', { error, userId, limit: limitStr });
    await ctx.editMessageText('Sorry, there was an error updating your settings. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:daily_limit')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Toggle notifications
 * @param ctx Context
 * @param userId User ID
 */
async function toggleNotifications(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get current settings
    const settings = await getUserSettings(ctx.dbConnection, userId);
    
    // Toggle notification setting
    const newValue = !settings.notificationEnabled;
    
    // Update user settings
    await updateUserSettings(ctx.dbConnection, userId, { notificationEnabled: newValue });
    
    // Show success message
    await ctx.editMessageText(
      `✅ Notifications ${newValue ? 'enabled' : 'disabled'} successfully.`,
      {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
          ]
        }
      }
    );
    
    logger.info('Notifications toggled', { userId, enabled: newValue });
  } catch (error) {
    logger.error('Error toggling notifications', { error, userId });
    await ctx.editMessageText('Sorry, there was an error updating your settings. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:notifications')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Prompt for custom sweep limit
 * @param ctx Context
 * @param userId User ID
 */
async function promptCustomSweepLimit(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get current settings
    const settings = await getUserSettings(ctx.dbConnection, userId);
    
    // Create message
    const message = `
🔢 *Enter Custom Sweep Limit*

Current value: ${settings.maxSweepQuantity} Axies
Maximum allowed: ${config.security.maxSweepQuantity} Axies

Please enter a number between 1 and ${config.security.maxSweepQuantity}:
    `;
    
    // Edit message with prompt
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Sweep Limit Options', 'settings:sweep_limit')]
        ]
      }
    });
    
    // Set session state to expect custom sweep limit input
    ctx.session.settingsAction = 'custom_sweep_limit';
    
    logger.info('Custom sweep limit prompt displayed', { userId });
  } catch (error) {
    logger.error('Error prompting for custom sweep limit', { error, userId });
    await ctx.editMessageText('Sorry, there was an error processing your request. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:sweep_limit')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Prompt for custom daily limit
 * @param ctx Context
 * @param userId User ID
 */
async function promptCustomDailyLimit(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Get current settings
    const settings = await getUserSettings(ctx.dbConnection, userId);
    
    // Create message
    const message = `
💰 *Enter Custom Daily Limit*

Current value: ${settings.dailyLimit} RON
Maximum allowed: ${config.security.maxDailyTransactionAmount} RON

Please enter a number between 1 and ${config.security.maxDailyTransactionAmount}:
    `;
    
    // Edit message with prompt
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔙 Back to Daily Limit Options', 'settings:daily_limit')]
        ]
      }
    });
    
    // Set session state to expect custom daily limit input
    ctx.session.settingsAction = 'custom_daily_limit';
    
    logger.info('Custom daily limit prompt displayed', { userId });
  } catch (error) {
    logger.error('Error prompting for custom daily limit', { error, userId });
    await ctx.editMessageText('Sorry, there was an error processing your request. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:daily_limit')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Reset settings to defaults
 * @param ctx Context
 * @param userId User ID
 */
async function resetToDefaults(ctx: any, userId: number): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
    
    // Update with default values
    await updateUserSettings(ctx.dbConnection, userId, {
      maxSweepQuantity: DEFAULT_MAX_SWEEP_QUANTITY,
      dailyLimit: DEFAULT_DAILY_LIMIT,
      notificationEnabled: DEFAULT_NOTIFICATION_ENABLED
    });
    
    // Show success message
    await ctx.editMessageText(
      '✅ Settings have been reset to default values.',
      {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
          ]
        }
      }
    );
    
    logger.info('Settings reset to defaults', { userId });
  } catch (error) {
    logger.error('Error resetting settings', { error, userId });
    await ctx.editMessageText('Sorry, there was an error resetting your settings. Please try again later.', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 Try Again', 'settings:reset_defaults')],
          [Markup.button.callback('🔙 Back to Settings', 'settings:menu')]
        ]
      }
    });
  }
}

/**
 * Get user settings from database
 * @param db Database connection
 * @param userId User ID
 * @returns User settings
 */
async function getUserSettings(db: any, userId: number): Promise<UserSettings> {
  try {
    // Get settings from database
    const settings = await db('user_settings')
      .where({ user_id: userId })
      .first();
    
    if (settings) {
      // Return existing settings
      return {
        userId,
        maxSweepQuantity: settings.max_sweep_quantity,
        dailyLimit: settings.daily_limit,
        notificationEnabled: settings.notification_enabled,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      };
    } else {
      // Create default settings
      const defaultSettings: UserSettings = {
        userId,
        maxSweepQuantity: DEFAULT_MAX_SWEEP_QUANTITY,
        dailyLimit: DEFAULT_DAILY_LIMIT,
        notificationEnabled: DEFAULT_NOTIFICATION_ENABLED,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Insert default settings
      await db('user_settings').insert({
        user_id: userId,
        max_sweep_quantity: defaultSettings.maxSweepQuantity,
        daily_limit: defaultSettings.dailyLimit,
        notification_enabled: defaultSettings.notificationEnabled,
        created_at: defaultSettings.createdAt,
        updated_at: defaultSettings.updatedAt
      });
      
      return defaultSettings;
    }
  } catch (error) {
    logger.error('Error getting user settings', { error, userId });
    throw error;
  }
}

/**
 * Update user settings
 * @param db Database connection
 * @param userId User ID
 * @param settings Partial settings to update
 */
async function updateUserSettings(
  db: any,
  userId: number,
  settings: Partial<UserSettings>
): Promise<void> {
  try {
    // Check if user settings exist
    const existingSettings = await db('user_settings')
      .where({ user_id: userId })
      .first();
    
    const updateData: any = {
      updated_at: new Date()
    };
    
    // Add fields to update
    if (settings.maxSweepQuantity !== undefined) {
      updateData.max_sweep_quantity = settings.maxSweepQuantity;
    }
    
    if (settings.dailyLimit !== undefined) {
      updateData.daily_limit = settings.dailyLimit;
    }
    
    if (settings.notificationEnabled !== undefined) {
      updateData.notification_enabled = settings.notificationEnabled;
    }
    
    if (existingSettings) {
      // Update existing settings
      await db('user_settings')
        .where({ user_id: userId })
        .update(updateData);
    } else {
      // Create new settings with defaults for missing fields
      const insertData = {
        user_id: userId,
        max_sweep_quantity: settings.maxSweepQuantity ?? DEFAULT_MAX_SWEEP_QUANTITY,
        daily_limit: settings.dailyLimit ?? DEFAULT_DAILY_LIMIT,
        notification_enabled: settings.notificationEnabled ?? DEFAULT_NOTIFICATION_ENABLED,
        created_at: new Date(),
        updated_at: new Date()
      };
      
      await db('user_settings').insert(insertData);
    }
    
    logger.info('User settings updated', { userId, settings });
  } catch (error) {
    logger.error('Error updating user settings', { error, userId, settings });
    throw error;
  }
}

/**
 * Handle custom settings input from text messages
 * This function should be called from the main message handler
 * @param ctx Context
 * @param text Input text
 */
export async function handleSettingsInput(ctx: any, text: string): Promise<boolean> {
  try {
    // Check if we're expecting settings input
    if (!ctx.session.settingsAction) {
      return false;
    }
    
    const userId = ctx.from?.id;
    
    // Get user ID from database
    const user = await ctx.dbConnection('users')
      .where({ telegram_id: userId })
      .first('id');
    
    if (!user) {
      await ctx.reply('Please start the bot with /start first.');
      return true;
    }
    
    // Handle different settings inputs
    switch (ctx.session.settingsAction) {
      case 'custom_sweep_limit':
        // Parse sweep limit
        const sweepLimit = parseInt(text);
        
        if (isNaN(sweepLimit) || sweepLimit <= 0) {
          await ctx.reply('Invalid input. Please enter a positive number.');
          return true;
        }
        
        // Update sweep limit
        await updateSweepLimit(ctx, user.id, sweepLimit.toString());
        break;
        
      case 'custom_daily_limit':
        // Parse daily limit
        const dailyLimit = parseFloat(text);
        
        if (isNaN(dailyLimit) || dailyLimit <= 0) {
          await ctx.reply('Invalid input. Please enter a positive number.');
          return true;
        }
        
        // Update daily limit
        await updateDailyLimit(ctx, user.id, dailyLimit.toString());
        break;
        
      default:
        return false;
    }
    
    // Clear session action
    ctx.session.settingsAction = undefined;
    
    return true;
  } catch (error) {
    logger.error('Error handling settings input', { error, text });
    await ctx.reply('Sorry, there was an error processing your input. Please try again later.');
    return true;
  }
}
