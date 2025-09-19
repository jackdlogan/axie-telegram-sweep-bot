/**
 * Debug script to check wallet status in the database
 * 
 * This script:
 * 1. Connects to the database
 * 2. Lists all users
 * 3. Lists all wallets with their user IDs and active status
 * 4. Checks for any orphaned wallets
 * 5. Logs everything clearly
 * 
 * Usage: ts-node debug-wallets.ts
 */

import dotenv from 'dotenv';
import knex from 'knex';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Initialize logger
const log = (title: string, data?: any) => {
  console.log('\n' + '='.repeat(80));
  console.log(`${title}`);
  console.log('='.repeat(80));
  if (data) {
    if (Array.isArray(data)) {
      if (data.length === 0) {
        console.log('No records found.');
      } else {
        console.table(data);
        console.log(`Total: ${data.length} records`);
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
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

async function main() {
  try {
    console.log('Connecting to database...');
    const db = knex(dbConfig);
    
    // Check database connection
    try {
      await db.raw('SELECT 1');
      console.log('Database connection successful!');
    } catch (error) {
      console.error('Database connection failed:', error);
      process.exit(1);
    }
    
    // 1. List all users
    const users = await db('users').select('*');
    log('USERS', users);
    
    // 2. List all wallets with their user IDs and active status
    const wallets = await db('wallets')
      .select('id', 'user_id', 'address', 'name', 'is_active', 'created_at');
    log('WALLETS', wallets);
    
    // 3. Check for any orphaned wallets (wallets without valid user IDs)
    const orphanedWallets = await db('wallets')
      .leftJoin('users', 'wallets.user_id', 'users.id')
      .whereNull('users.id')
      .select('wallets.*');
    log('ORPHANED WALLETS (wallets without valid user IDs)', orphanedWallets);
    
    // 4. Check active wallets per user
    const activeWallets = await db('wallets')
      .where('is_active', true)
      .select('id', 'user_id', 'address', 'name', 'created_at');
    log('ACTIVE WALLETS', activeWallets);
    
    // 5. Check wallet counts per user
    const walletCounts = await db('wallets')
      .select('user_id')
      .count('id as wallet_count')
      .groupBy('user_id');
    log('WALLET COUNTS PER USER', walletCounts);
    
    // 6. Check active wallet counts per user
    const activeWalletCounts = await db('wallets')
      .where('is_active', true)
      .select('user_id')
      .count('id as active_wallet_count')
      .groupBy('user_id');
    log('ACTIVE WALLET COUNTS PER USER', activeWalletCounts);
    
    // 7. Check if there are any issues with wallet creation
    const recentWallets = await db('wallets')
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('id', 'user_id', 'address', 'name', 'is_active', 'created_at');
    log('MOST RECENT WALLETS', recentWallets);
    
    // 8. Check the database schema for wallets table
    let walletColumns;
    if (dbConfig.client === 'sqlite') {
      const tableInfo = await db.raw(`PRAGMA table_info(wallets)`);
      walletColumns = tableInfo.map((col: any) => ({
        name: col.name,
        type: col.type,
        notnull: col.notnull === 1 ? 'NOT NULL' : 'NULL',
        dflt_value: col.dflt_value
      }));
    } else {
      // PostgreSQL
      const tableInfo = await db.raw(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'wallets'
      `);
      walletColumns = tableInfo.rows.map((col: any) => ({
        name: col.column_name,
        type: col.data_type,
        notnull: col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL',
        dflt_value: col.column_default
      }));
    }
    log('WALLETS TABLE SCHEMA', walletColumns);
    
    console.log('\nDebug completed successfully!');
    await db.destroy();
  } catch (error) {
    console.error('Error during debug:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error);
