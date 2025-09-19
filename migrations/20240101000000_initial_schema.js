/**
 * Initial database schema migration for Axie Marketplace Sweep Bot
 * 
 * This migration creates all the required tables:
 * - users: Store user information
 * - wallets: Store wallet information
 * - transactions: Store transaction details
 * - sweep_history: Store sweep operation history
 * - user_settings: Store user preferences
 * - collection_stats: Store collection statistics
 */
exports.up = function(knex) {
  return knex.schema
    // Users table
    .createTable('users', function(table) {
      table.increments('id').primary();
      table.bigInteger('telegram_id').notNullable().unique().index();
      table.string('username', 255).nullable();
      table.string('first_name', 255).nullable();
      table.string('last_name', 255).nullable();
      table.boolean('is_admin').defaultTo(false);
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    
    // Wallets table
    .createTable('wallets', function(table) {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('name', 255).nullable();
      table.string('address', 255).notNullable().index();
      table.text('encrypted_private_key').notNullable();
      table.text('encrypted_seed_phrase').nullable();
      table.boolean('is_active').defaultTo(false);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    
    // Transactions table
    .createTable('transactions', function(table) {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('wallet_id').unsigned().notNullable().references('id').inTable('wallets').onDelete('CASCADE');
      table.string('tx_hash', 255).notNullable().unique().index();
      table.string('tx_type', 50).notNullable().index();
      table.string('status', 50).notNullable().defaultTo('pending').index();
      table.decimal('amount', 24, 18).notNullable();
      table.decimal('gas_used', 24, 18).nullable();
      table.json('metadata').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('confirmed_at').nullable();
    })
    
    // Sweep history table
    .createTable('sweep_history', function(table) {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('wallet_id').unsigned().notNullable().references('id').inTable('wallets').onDelete('CASCADE');
      table.integer('transaction_id').unsigned().nullable().references('id').inTable('transactions').onDelete('SET NULL');
      table.string('collection', 100).notNullable().index();
      table.integer('quantity').notNullable();
      table.decimal('max_price', 24, 18).nullable();
      table.decimal('total_amount', 24, 18).notNullable();
      table.json('axie_ids').notNullable();
      table.string('status', 50).notNullable().defaultTo('pending').index();
      table.json('metadata').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('completed_at').nullable();
    })
    
    // User settings table
    .createTable('user_settings', function(table) {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE').unique();
      table.decimal('max_transaction_amount', 24, 18).nullable();
      table.decimal('max_daily_transaction_amount', 24, 18).nullable();
      table.integer('max_sweep_quantity').nullable();
      table.boolean('notifications_enabled').defaultTo(true);
      table.boolean('auto_gas_enabled').defaultTo(true);
      table.decimal('gas_price_multiplier', 8, 2).defaultTo(1.0);
      table.json('preferred_collections').nullable();
      table.json('additional_settings').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    
    // Collection stats table
    .createTable('collection_stats', function(table) {
      table.increments('id').primary();
      table.string('collection', 100).notNullable().index();
      table.decimal('floor_price', 24, 18).notNullable();
      table.decimal('avg_10_price', 24, 18).notNullable();
      table.decimal('avg_50_price', 24, 18).nullable();
      table.decimal('avg_100_price', 24, 18).nullable();
      table.integer('total_listed').notNullable();
      table.decimal('volume_24h', 24, 18).nullable();
      table.decimal('volume_7d', 24, 18).nullable();
      table.decimal('floor_price_usd', 24, 2).nullable();
      table.timestamp('timestamp').defaultTo(knex.fn.now()).index();
    });
};

/**
 * Revert the migration by dropping all tables in reverse order
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('collection_stats')
    .dropTableIfExists('user_settings')
    .dropTableIfExists('sweep_history')
    .dropTableIfExists('transactions')
    .dropTableIfExists('wallets')
    .dropTableIfExists('users');
};
