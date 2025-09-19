/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('transfers', table => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    table.integer('wallet_id').unsigned().notNullable();
    table.string('tx_hash').notNullable();
    table.text('axie_ids').notNullable(); // JSON array of Axie IDs
    table.string('recipient_address').notNullable();
    table.integer('axie_count').notNullable();
    table.string('status').defaultTo('completed'); // pending, completed, failed
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Foreign keys
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('wallet_id').references('wallets.id').onDelete('CASCADE');
    
    // Indexes
    table.index('user_id');
    table.index('wallet_id');
    table.index('tx_hash');
    table.index('created_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('transfers');
};
