require('ts-node/register');
const path = require('path');

// Import the config module
// Since this is a TypeScript module, we need to use ts-node to load it
const config = require('./src/config').default;

/**
 * Knex Configuration
 * This file configures the database connection for migrations
 * It supports both PostgreSQL and SQLite based on the configuration
 */
module.exports = {
  // Development environment configuration
  development: {
    client: config.database.type === 'postgres' ? 'pg' : 'sqlite3',
    connection: config.database.type === 'postgres' 
      ? {
          host: config.database.postgres.host,
          port: config.database.postgres.port,
          user: config.database.postgres.user,
          password: config.database.postgres.password,
          database: config.database.postgres.database,
          ssl: config.database.postgres.ssl ? { rejectUnauthorized: false } : false,
        }
      : {
          filename: config.database.sqlite.filename,
        },
    pool: config.database.type === 'postgres'
      ? {
          min: 2,
          max: 10,
        }
      : {
          min: 1,
          max: 5,
          afterCreate: (conn, done) => {
            // Enable foreign keys for SQLite
            conn.run('PRAGMA foreign_keys = ON;', done);
          },
        },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'src/database/migrations'),
      extension: 'ts',
    },
    seeds: {
      directory: path.join(__dirname, 'src/database/seeds'),
      extension: 'ts',
    },
    useNullAsDefault: config.database.type === 'sqlite',
    debug: config.misc.debug,
  },

  // Production environment configuration
  production: {
    client: config.database.type === 'postgres' ? 'pg' : 'sqlite3',
    connection: config.database.type === 'postgres' 
      ? {
          host: config.database.postgres.host,
          port: config.database.postgres.port,
          user: config.database.postgres.user,
          password: config.database.postgres.password,
          database: config.database.postgres.database,
          ssl: config.database.postgres.ssl ? { rejectUnauthorized: false } : false,
        }
      : {
          filename: config.database.sqlite.filename,
        },
    pool: config.database.type === 'postgres'
      ? {
          min: 2,
          max: 10,
        }
      : {
          min: 1,
          max: 5,
          afterCreate: (conn, done) => {
            // Enable foreign keys for SQLite
            conn.run('PRAGMA foreign_keys = ON;', done);
          },
        },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'src/database/migrations'),
      extension: 'ts',
    },
    seeds: {
      directory: path.join(__dirname, 'src/database/seeds'),
      extension: 'ts',
    },
    useNullAsDefault: config.database.type === 'sqlite',
    debug: false, // Disable debug in production
  },

  // Test environment configuration
  test: {
    client: 'sqlite3',
    connection: {
      filename: ':memory:', // Use in-memory SQLite for tests
    },
    pool: {
      min: 1,
      max: 1,
      afterCreate: (conn, done) => {
        // Enable foreign keys for SQLite
        conn.run('PRAGMA foreign_keys = ON;', done);
      },
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'src/database/migrations'),
      extension: 'ts',
    },
    seeds: {
      directory: path.join(__dirname, 'src/database/seeds'),
      extension: 'ts',
    },
    useNullAsDefault: true,
    debug: false,
  },
};
