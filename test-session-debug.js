// test-session-debug.js
const { Telegraf, session } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const fs = require('fs');
const path = require('path');

// Create a test bot with a fake token
const bot = new Telegraf('test_token');

// Set up session middleware with local storage
const sessionMiddleware = new LocalSession({
  database: 'sessions.json',
  property: 'session',
  storage: LocalSession.storageMemory,
  format: {
    serialize: (obj) => JSON.stringify(obj, null, 2),
    deserialize: (str) => JSON.parse(str),
  },
  state: { 
    sweepAction: undefined,
    sweepCollection: undefined,
    sweepQuantity: undefined
  }
});

// Use session middleware
bot.use(sessionMiddleware.middleware());

// Debug middleware to log all updates and session state
bot.use((ctx, next) => {
  console.log('\n--- INCOMING UPDATE ---');
  console.log('Update type:', ctx.updateType);
  console.log('Current session state:', JSON.stringify(ctx.session, null, 2));
  return next();
});

// Handle text messages
bot.on('text', (ctx) => {
  console.log('\n--- TEXT RECEIVED ---');
  console.log('Text:', ctx.message.text);
  console.log('Session before processing:', JSON.stringify(ctx.session, null, 2));
  
  // Check if sweepAction is set to custom_quantity
  if (ctx.session.sweepAction === 'custom_quantity') {
    console.log('✅ sweepAction recognized as custom_quantity');
    const qty = parseInt(ctx.message.text.trim(), 10);
    
    if (isNaN(qty) || qty <= 0 || qty > 100) {
      console.log('❌ Invalid quantity:', ctx.message.text);
      return ctx.reply('Invalid quantity. Enter a number between 1 and 100.');
    }
    
    console.log('✅ Valid quantity:', qty);
    ctx.session.sweepQuantity = qty;
    ctx.session.sweepAction = undefined; // reset
    
    console.log('Session after processing:', JSON.stringify(ctx.session, null, 2));
    return ctx.reply(`Quantity set to ${qty}. Preview would be shown here.`);
  } else {
    console.log('❌ sweepAction NOT recognized. Current value:', ctx.session.sweepAction);
    return ctx.reply("I'm not sure what you want to do.");
  }
});

// Command to simulate setting sweepAction
bot.command('setcustomquantity', (ctx) => {
  console.log('\n--- SETTING CUSTOM QUANTITY STATE ---');
  ctx.session.sweepAction = 'custom_quantity';
  ctx.session.sweepCollection = 'regular';
  console.log('Session after setting:', JSON.stringify(ctx.session, null, 2));
  return ctx.reply('Now in custom quantity mode. Please enter a number:');
});

// Command to check session state
bot.command('checksession', (ctx) => {
  console.log('\n--- CHECKING SESSION ---');
  return ctx.reply(`Current session state: ${JSON.stringify(ctx.session, null, 2)}`);
});

// Command to clear session
bot.command('clearsession', (ctx) => {
  console.log('\n--- CLEARING SESSION ---');
  ctx.session = {};
  return ctx.reply('Session cleared');
});

// Start the bot in webhook mode for testing
bot.launch({
  webhook: {
    domain: 'https://example.com',
    port: 3000
  }
}).then(() => {
  console.log('Bot started in webhook mode');
  console.log('Session debug test ready');
  console.log('\nTest instructions:');
  console.log('1. Use /setcustomquantity to simulate entering custom quantity mode');
  console.log('2. Send a number to test if sweepAction is recognized');
  console.log('3. Use /checksession to verify the current session state');
  console.log('4. Use /clearsession to reset the session');
  
  // Simulate the flow automatically
  console.log('\n--- SIMULATING FLOW ---');
  
  // Create mock context with session
  const mockCtx = {
    session: {},
    updateType: 'message',
    reply: (text) => {
      console.log('Bot reply:', text);
      return Promise.resolve();
    }
  };
  
  // Step 1: Set custom quantity mode
  console.log('\nStep 1: Setting custom quantity mode');
  mockCtx.session.sweepAction = 'custom_quantity';
  mockCtx.session.sweepCollection = 'regular';
  console.log('Session state:', JSON.stringify(mockCtx.session, null, 2));
  
  // Step 2: Simulate receiving a text message
  console.log('\nStep 2: Receiving text message "5"');
  const textHandler = bot.middleware()[bot.middleware().length - 1];
  
  // Create a mock message context
  const mockMessageCtx = {
    ...mockCtx,
    message: { text: '5' },
    updateType: 'message'
  };
  
  // Process the mock message
  console.log('Session before processing:', JSON.stringify(mockMessageCtx.session, null, 2));
  textHandler(mockMessageCtx, () => {});
  console.log('Session after processing:', JSON.stringify(mockMessageCtx.session, null, 2));
  
  console.log('\n--- SIMULATION COMPLETE ---');
  console.log('Check if sweepAction was properly recognized and processed');
  
  // Write findings to a file
  const findings = `
Session Debug Findings:
1. Initial session state: ${JSON.stringify(mockCtx.session, null, 2)}
2. After text processing: ${JSON.stringify(mockMessageCtx.session, null, 2)}
3. sweepAction recognized: ${mockMessageCtx.session.sweepAction === undefined && mockMessageCtx.session.sweepQuantity === 5}
  `;
  
  fs.writeFileSync(path.join(__dirname, 'session-debug-findings.txt'), findings);
  console.log('\nFindings written to session-debug-findings.txt');
});

// Handle errors
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
