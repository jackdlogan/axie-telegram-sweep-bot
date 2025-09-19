/**
 * Cleanup Wallets Script
 * 
 * This script finds users with multiple wallets and keeps only the most recent one.
 * It's designed to be run once to migrate from a multi-wallet to single-wallet system.
 * 
 * Usage: npx ts-node cleanup-wallets.ts
 */

import dotenv from 'dotenv';
import knex from 'knex';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Initialize logger
const log = (message: string, data?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
  console.log('-------------------------------------------');
};

// Database configuration
const dbConfig = {
  client: process.env.DB_TYPE || 'sqlite',
  connection: process.env.DB_TYPE === 'postgres' 
    ? {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        user: process.env.POSTGRES_USER || 'axie_bot_user',
        password: process.env.POSTGRES_PASSWORD || 'password',
        database: process.env.POSTGRES_DB || 'axie_bot_db',
        ssl: process.env.POSTGRES_SSL === 'true'
      }
    : {
        filename: process.env.SQLITE_FILENAME || './data/axie_bot.sqlite'
      },
  useNullAsDefault: process.env.DB_TYPE === 'sqlite'
};

// Ensure SQLite data directory exists
if (dbConfig.client === 'sqlite') {
  const dbDir = path.dirname(dbConfig.connection.filename as string);
  if (!fs.existsSync(dbDir)) {
    console.log(`Creating database directory: ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

async function cleanupWallets() {
  log('Starting wallet cleanup process');
  
  // Connect to database
  const db = knex(dbConfig);
  
  try {
    // Check database connection
    await db.raw('SELECT 1');
    log('Database connection successful');
    
    // Find users with multiple wallets
    const userWalletCounts = await db('wallets')
      .select('user_id')
      .count('id as wallet_count')
      .groupBy('user_id')
      .having(db.raw('count(id)'), '>', 1);
    
    if (userWalletCounts.length === 0) {
      log('No users with multiple wallets found. Nothing to clean up.');
      await db.destroy();
      return;
    }
    
    log(`Found ${userWalletCounts.length} users with multiple wallets`, userWalletCounts);
    
    // Process each user with multiple wallets
    let totalWalletsDeleted = 0;
    let totalWalletsKept = 0;
    
    for (const userCount of userWalletCounts) {
      const userId = userCount.user_id;
      
      // Get all wallets for this user, ordered by creation date (newest first)
      const userWallets = await db('wallets')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .select('id', 'address', 'name', 'created_at');
      
      // Keep the newest wallet
      const newestWallet = userWallets[0];
      const walletsToDelete = userWallets.slice(1);
      
      log(`User ${userId}: Keeping newest wallet`, {
        id: newestWallet.id,
        address: newestWallet.address,
        name: newestWallet.name,
        created_at: newestWallet.created_at
      });
      
      // Make sure the newest wallet is set as active
      await db('wallets')
        .where({ id: newestWallet.id })
        .update({ 
          is_active: true,
          updated_at: new Date()
        });
      
      // Delete older wallets
      if (walletsToDelete.length > 0) {
        const walletIds = walletsToDelete.map(w => w.id);
        
        log(`User ${userId}: Deleting ${walletsToDelete.length} older wallets`, {
          walletIds,
          addresses: walletsToDelete.map(w => w.address)
        });
        
        // Delete wallets
        const deleted = await db('wallets')
          .whereIn('id', walletIds)
          .delete();
        
        log(`User ${userId}: Deleted ${deleted} wallets`);
        
        totalWalletsDeleted += deleted;
        totalWalletsKept++;
      }
    }
    
    // Log summary
    log('Wallet cleanup completed', {
      usersProcessed: userWalletCounts.length,
      walletsKept: totalWalletsKept,
      walletsDeleted: totalWalletsDeleted
    });
    
  } catch (error) {
    log('Error during wallet cleanup', error);
  } finally {
    // Close database connection
    await db.destroy();
    log('Database connection closed');
  }
}

// Run the cleanup function
cleanupWallets()
  .then(() => {
    log('Wallet cleanup script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    log('Fatal error during wallet cleanup', error);
    process.exit(1);
  });
