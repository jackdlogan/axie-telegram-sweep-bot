import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create users table
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.bigInteger('telegram_id').notNullable().unique().index();
    table.string('username', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Create wallets table
  await knex.schema.createTable('wallets', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    table.string('address', 42).notNullable().unique().index();
    table.text('encrypted_private_key').notNullable();
    table.string('name', 255).nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Foreign key constraint
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    
    // Index for faster queries
    table.index(['user_id', 'is_active']);
  });

  // Create transactions table
  await knex.schema.createTable('transactions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    table.integer('wallet_id').unsigned().notNullable();
    table.string('tx_hash', 66).notNullable().unique().index();
    table.string('collection', 255).notNullable().index();
    table.specificType('axie_ids', 'TEXT[]').notNullable();
    table.decimal('total_amount', 20, 8).notNullable();
    table.decimal('gas_used', 20, 8).nullable();
    table.enum('status', ['pending', 'confirmed', 'failed']).defaultTo('pending').index();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Foreign key constraints
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.foreign('wallet_id').references('id').inTable('wallets').onDelete('CASCADE');
    
    // Composite indexes for common queries
    table.index(['user_id', 'status']);
    table.index(['wallet_id', 'status']);
    table.index(['collection', 'created_at']);
  });

  // Create price_history table
  await knex.schema.createTable('price_history', (table) => {
    table.increments('id').primary();
    table.string('collection', 255).notNullable().index();
    table.decimal('floor_price', 20, 8).notNullable();
    table.decimal('avg_10', 20, 8).notNullable();
    table.decimal('avg_50', 20, 8).notNullable();
    table.decimal('avg_100', 20, 8).notNullable();
    table.integer('total_listed').unsigned().notNullable();
    table.timestamp('timestamp').defaultTo(knex.fn.now()).index();
    
    // Composite index for time-series queries
    table.index(['collection', 'timestamp']);
  });

  // Create user_settings table
  await knex.schema.createTable('user_settings', (table) => {
    table.integer('user_id').unsigned().notNullable().primary();
    table.integer('max_sweep_quantity').unsigned().defaultTo(20);
    table.decimal('daily_limit', 20, 8).defaultTo(10);
    table.boolean('notification_enabled').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Foreign key constraint
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order to avoid foreign key constraint issues
  await knex.schema.dropTableIfExists('user_settings');
  await knex.schema.dropTableIfExists('price_history');
  await knex.schema.dropTableIfExists('transactions');
  await knex.schema.dropTableIfExists('wallets');
  await knex.schema.dropTableIfExists('users');
}
