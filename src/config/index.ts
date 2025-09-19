import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config();

// Define interfaces for each configuration section
interface TelegramConfig {
  botToken: string;
  adminUserIds: number[];
}

interface BlockchainConfig {
  roninMainnetRpc: string;
  roninTestnetRpc: string;
  /**
   * Optional API key required for the official Sky Mavis API-Gateway endpoints.
   * Leave empty when using a third-party public RPC (e.g. Chainstack, dRPC, Moralis, …).
   */
  roninApiKey: string;
  axieContractAddress: string;
  marketplaceContractAddress: string;
  /**
   * Wrapped ETH (WETH) contract address – payment token for Axie marketplace.
   */
  wethTokenAddress: string;
  ronTokenAddress: string;
  /**
   * Axie NFT (ERC-721) contract address – used for querying user holdings.
   */
  axieNftContractAddress: string;
  /**
   * Ronin chain ID (mainnet = 2020, Saigon testnet = 2021)
   */
  chainId: number;
  defaultGasLimit: number;
  gasPriceStrategy: 'standard' | 'fast' | 'fastest';
  gasPriceMultiplier: number;
  maxGasPriceGwei: number;
}

interface DatabaseConfig {
  type: 'postgres' | 'sqlite';
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: boolean;
  };
  sqlite: {
    filename: string;
  };
}

interface RedisConfig {
  enabled: boolean;
  host: string;
  port: number;
  password: string | null;
  db: number;
  cacheTtl: number;
}

interface ApiConfig {
  axieGraphqlApi: string;
  axieGraphqlApiBackup: string;
  /**
   * Optional Sky Mavis GraphQL API key.
   * Required when using the official api-gateway endpoint.
   */
  axieGraphqlApiKey: string;
  maxRequestsPerMinute: number;
  requestDelay: number;
}

interface SecurityConfig {
  encryptionKey: string;
  jwtSecret: string;
  jwtExpiration: number;
  maxTransactionAmount: number;
  maxDailyTransactionAmount: number;
  maxSweepQuantity: number;
}

interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug' | 'verbose';
  toFile: boolean;
  filePath: string;
  maxSize: number;
  maxFiles: number;
}

interface MiscConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  debug: boolean;
  defaultTimeout: number;
}

// Main configuration interface
export interface Config {
  telegram: TelegramConfig;
  blockchain: BlockchainConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  api: ApiConfig;
  security: SecurityConfig;
  logging: LoggingConfig;
  misc: MiscConfig;
}

// Helper function to validate required environment variables
function validateRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is missing`);
  }
  return value;
}

// Helper function to get optional environment variables with default values
function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

// Helper function to parse boolean environment variables
function parseBoolean(value: string): boolean {
  return value.toLowerCase() === 'true';
}

// Helper function to parse number environment variables
function parseNumber(value: string, defaultValue: number): number {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Helper function to parse comma-separated list of numbers
function parseNumberArray(value: string): number[] {
  if (!value) return [];
  return value.split(',').map(item => parseInt(item.trim(), 10)).filter(num => !isNaN(num));
}

// Create and validate the configuration
const config: Config = {
  telegram: {
    botToken: validateRequiredEnv('TELEGRAM_BOT_TOKEN'),
    adminUserIds: parseNumberArray(getOptionalEnv('ADMIN_USER_IDS', '')),
  },
  blockchain: {
    /*
     * Ronin RPC Endpoint Options
     * 1. Official Sky Mavis gateway (requires X-API-KEY): https://api-gateway.skymavis.com/rpc
     * 2. Public RPC with no key required (default):       https://api.roninchain.com/rpc
     * 3. Alternative community RPC (no key):             https://ronin.drpc.org
     *
     * You may override these via environment variables:
     *   RONIN_MAINNET_RPC, RONIN_TESTNET_RPC, RONIN_API_KEY
     */
    roninMainnetRpc: getOptionalEnv('RONIN_MAINNET_RPC', 'https://api.roninchain.com/rpc'),
    roninTestnetRpc: getOptionalEnv('RONIN_TESTNET_RPC', 'https://saigon-testnet.roninchain.com/rpc'),
    roninApiKey: getOptionalEnv('RONIN_API_KEY', ''), // Only required for official Sky Mavis endpoints
    axieContractAddress: getOptionalEnv('AXIE_CONTRACT_ADDRESS', '0x32950db2a7164ae833121501c797d79e7b79d74c'),
    marketplaceContractAddress: getOptionalEnv('MARKETPLACE_CONTRACT_ADDRESS', '0x213073989821f738a7ba3520c3d31a1f9ad31bbd'),
    // Updated to the correct WETH contract address on Ronin mainnet
    wethTokenAddress: getOptionalEnv('WETH_CONTRACT_ADDRESS', '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5'),
    ronTokenAddress: getOptionalEnv('RON_TOKEN_ADDRESS', '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4'),
    axieNftContractAddress: getOptionalEnv('AXIE_NFT_CONTRACT_ADDRESS', '0x32950db2a7164ae833121501c797d79e7b79d74c'),
    chainId: parseNumber(getOptionalEnv('CHAIN_ID', '2020'), 2020),
    defaultGasLimit: parseNumber(getOptionalEnv('DEFAULT_GAS_LIMIT', '500000'), 500000),
    gasPriceStrategy: getOptionalEnv('GAS_PRICE_STRATEGY', 'fast') as 'standard' | 'fast' | 'fastest',
    gasPriceMultiplier: parseFloat(getOptionalEnv('GAS_PRICE_MULTIPLIER', '1.1')),
    maxGasPriceGwei: parseNumber(getOptionalEnv('MAX_GAS_PRICE_GWEI', '100'), 100),
  },
  database: {
    type: getOptionalEnv('DB_TYPE', 'sqlite') as 'postgres' | 'sqlite',
    postgres: {
      host: getOptionalEnv('POSTGRES_HOST', 'localhost'),
      port: parseNumber(getOptionalEnv('POSTGRES_PORT', '5432'), 5432),
      user: getOptionalEnv('POSTGRES_USER', 'axie_bot_user'),
      password: getOptionalEnv('POSTGRES_PASSWORD', 'password'),
      database: getOptionalEnv('POSTGRES_DB', 'axie_bot_db'),
      ssl: parseBoolean(getOptionalEnv('POSTGRES_SSL', 'false')),
    },
    sqlite: {
      filename: getOptionalEnv('SQLITE_FILENAME', './data/axie_bot.sqlite'),
    },
  },
  redis: {
    enabled: parseBoolean(getOptionalEnv('REDIS_ENABLED', 'false')),
    host: getOptionalEnv('REDIS_HOST', 'localhost'),
    port: parseNumber(getOptionalEnv('REDIS_PORT', '6379'), 6379),
    password: getOptionalEnv('REDIS_PASSWORD', '') || null,
    db: parseNumber(getOptionalEnv('REDIS_DB', '0'), 0),
    cacheTtl: parseNumber(getOptionalEnv('REDIS_CACHE_TTL', '300'), 300),
  },
  api: {
    /*
     * Axie Infinity GraphQL endpoints
     * ------------------------------------------------------------------
     * The user explicitly requested to use the official marketplace
     * gateway: https://graphql-gateway.axieinfinity.com/graphql
     * We therefore:
     *   1. Read AXIE_GRAPHQL_API from the environment (falls back to the
     *      same URL if not provided).
     *   2. Set the backup endpoint to the same URL, because only a single
     *      endpoint has been specified by the user.
     */
    axieGraphqlApi: getOptionalEnv(
      'AXIE_GRAPHQL_API',
      'https://graphql-gateway.axieinfinity.com/graphql'
    ),
    axieGraphqlApiBackup: getOptionalEnv(
      'AXIE_GRAPHQL_API_BACKUP',
      'https://graphql-gateway.axieinfinity.com/graphql'
    ),
    axieGraphqlApiKey: getOptionalEnv('AXIE_GRAPHQL_API_KEY', ''),
    maxRequestsPerMinute: parseNumber(getOptionalEnv('API_MAX_REQUESTS_PER_MINUTE', '60'), 60),
    requestDelay: parseNumber(getOptionalEnv('API_REQUEST_DELAY', '1000'), 1000),
  },
  security: {
    encryptionKey: validateRequiredEnv('ENCRYPTION_KEY'),
    jwtSecret: getOptionalEnv('JWT_SECRET', 'default_jwt_secret_change_in_production'),
    jwtExpiration: parseNumber(getOptionalEnv('JWT_EXPIRATION', '86400'), 86400),
    maxTransactionAmount: parseNumber(getOptionalEnv('MAX_TRANSACTION_AMOUNT', '10'), 10),
    maxDailyTransactionAmount: parseNumber(getOptionalEnv('MAX_DAILY_TRANSACTION_AMOUNT', '50'), 50),
    maxSweepQuantity: parseNumber(getOptionalEnv('MAX_SWEEP_QUANTITY', '100'), 100),
  },
  logging: {
    level: getOptionalEnv('LOG_LEVEL', 'info') as 'error' | 'warn' | 'info' | 'debug' | 'verbose',
    toFile: parseBoolean(getOptionalEnv('LOG_TO_FILE', 'true')),
    filePath: getOptionalEnv('LOG_FILE_PATH', './logs/axie-bot.log'),
    maxSize: parseNumber(getOptionalEnv('LOG_MAX_SIZE', '10'), 10),
    maxFiles: parseNumber(getOptionalEnv('LOG_MAX_FILES', '5'), 5),
  },
  misc: {
    nodeEnv: getOptionalEnv('NODE_ENV', 'development') as 'development' | 'production' | 'test',
    port: parseNumber(getOptionalEnv('PORT', '3000'), 3000),
    debug: parseBoolean(getOptionalEnv('DEBUG', 'false')),
    defaultTimeout: parseNumber(getOptionalEnv('DEFAULT_TIMEOUT', '30000'), 30000),
  },
};

// Ensure log directory exists
if (config.logging.toFile) {
  const logDir = path.dirname(config.logging.filePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// Ensure SQLite data directory exists if using SQLite
if (config.database.type === 'sqlite') {
  const dbDir = path.dirname(config.database.sqlite.filename);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// Validate critical configuration
if (config.misc.nodeEnv === 'production') {
  // In production, ensure we have strong encryption key
  if (config.security.encryptionKey.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters in production mode');
  }
  
  // Ensure we're not using default JWT secret in production
  if (config.security.jwtSecret === 'default_jwt_secret_change_in_production') {
    throw new Error('Default JWT_SECRET cannot be used in production mode');
  }
}

export default config;
