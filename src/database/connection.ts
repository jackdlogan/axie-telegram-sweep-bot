import knex, { Knex } from 'knex';
import path from 'path';
import config from '../config';
import Logger from '../utils/logger';

const logger = new Logger('database');

/**
 * Database connection manager for the Axie Marketplace Sweep Bot
 * Supports both PostgreSQL and SQLite based on configuration
 */
class DatabaseConnection {
  private static instance: Knex | null = null;
  private static connectionPromise: Promise<Knex> | null = null;

  /**
   * Get the database connection instance (singleton pattern)
   * Creates a new connection if one doesn't exist
   */
  public static async getConnection(): Promise<Knex> {
    if (this.instance) {
      return this.instance;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.createConnection();
    this.instance = await this.connectionPromise;
    this.connectionPromise = null;
    
    return this.instance;
  }

  /**
   * Create a new database connection based on configuration
   */
  private static async createConnection(): Promise<Knex> {
    try {
      logger.info(`Initializing ${config.database.type} database connection`);
      
      let knexConfig: Knex.Config;
      
      if (config.database.type === 'postgres') {
        knexConfig = {
          client: 'pg',
          connection: {
            host: config.database.postgres.host,
            port: config.database.postgres.port,
            user: config.database.postgres.user,
            password: config.database.postgres.password,
            database: config.database.postgres.database,
            ssl: config.database.postgres.ssl ? { rejectUnauthorized: false } : false,
          },
          pool: {
            min: 2,
            max: 10,
            // Acquire promises are rejected after this timeout
            acquireTimeoutMillis: 30000,
            // How long a resource can stay idle before being released
            idleTimeoutMillis: 30000,
            // How long to wait before timing out a query
            createTimeoutMillis: 30000,
            // How long to wait before destroying a connection
            destroyTimeoutMillis: 5000,
            // How often to check for idle resources to destroy
            reapIntervalMillis: 1000,
            // How long to wait for resources to be released before force-destroying
            createRetryIntervalMillis: 200,
          },
          debug: config.misc.debug,
          migrations: {
            tableName: 'knex_migrations',
            directory: path.join(__dirname, '../../migrations'),
          },
        };
      } else {
        // SQLite configuration
        knexConfig = {
          client: 'sqlite3',
          connection: {
            filename: config.database.sqlite.filename,
          },
          useNullAsDefault: true,
          pool: {
            min: 1,
            max: 5,
            afterCreate: (conn: any, done: Function) => {
              // Enable foreign keys support for SQLite
              conn.run('PRAGMA foreign_keys = ON;', done);
            },
          },
          debug: config.misc.debug,
          migrations: {
            tableName: 'knex_migrations',
            directory: path.join(__dirname, '../../migrations'),
          },
        };
      }

      const connection = knex(knexConfig);
      
      // Test the connection
      await this.testConnection(connection);
      
      logger.info('Database connection established successfully');
      return connection;
    } catch (error) {
      logger.error('Failed to establish database connection', { error });
      throw error;
    }
  }

  /**
   * Test the database connection
   */
  private static async testConnection(connection: Knex): Promise<void> {
    try {
      if (config.database.type === 'postgres') {
        await connection.raw('SELECT 1');
      } else {
        await connection.raw('SELECT 1');
      }
      logger.debug('Database connection test successful');
    } catch (error) {
      logger.error('Database connection test failed', { error });
      throw new Error(`Failed to connect to ${config.database.type} database: ${(error as Error).message}`);
    }
  }

  /**
   * Close the database connection
   */
  public static async closeConnection(): Promise<void> {
    if (this.instance) {
      try {
        await this.instance.destroy();
        this.instance = null;
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error closing database connection', { error });
        throw error;
      }
    }
  }

  /**
   * Run database migrations
   */
  public static async runMigrations(): Promise<void> {
    const connection = await this.getConnection();
    try {
      logger.info('Running database migrations');
      await connection.migrate.latest();
      logger.info('Database migrations completed successfully');
    } catch (error) {
      logger.error('Failed to run database migrations', { error });
      throw error;
    }
  }

  /**
   * Rollback the last batch of migrations
   */
  public static async rollbackMigration(): Promise<void> {
    const connection = await this.getConnection();
    try {
      logger.info('Rolling back the last batch of migrations');
      await connection.migrate.down();
      logger.info('Migration rollback completed successfully');
    } catch (error) {
      logger.error('Failed to rollback migrations', { error });
      throw error;
    }
  }

  /**
   * Get the current migration version
   */
  public static async getMigrationVersion(): Promise<string> {
    const connection = await this.getConnection();
    try {
      const [result] = await connection.migrate.currentVersion();
      return result;
    } catch (error) {
      logger.error('Failed to get migration version', { error });
      throw error;
    }
  }
}

export default DatabaseConnection;
