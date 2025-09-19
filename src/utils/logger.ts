import winston from 'winston';
import config from '../config';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define console format (more readable than JSON)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let metaStr = '';
    if (Object.keys(metadata).length > 0) {
      if (metadata.stack) {
        metaStr = `\n${metadata.stack}`;
      } else {
        metaStr = `\n${JSON.stringify(metadata, null, 2)}`;
      }
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Create transports array
const transports: winston.transport[] = [
  // Always add console transport
  new winston.transports.Console({
    format: consoleFormat,
    level: config.logging.level,
  })
];

// Add file transport if enabled in config
if (config.logging.toFile) {
  transports.push(
    new winston.transports.File({
      filename: config.logging.filePath,
      format: logFormat,
      level: config.logging.level,
      maxsize: config.logging.maxSize * 1024 * 1024, // Convert MB to bytes
      maxFiles: config.logging.maxFiles,
      tailable: true,
    })
  );
}

// Create the logger
const winstonLogger = winston.createLogger({
  level: config.logging.level,
  levels: winston.config.npm.levels,
  defaultMeta: { service: 'axie-sweep-bot' },
  transports,
  exitOnError: false,
});

// Create a class wrapper for the logger to add additional functionality
class Logger {
  private context: string;

  constructor(context: string = 'app') {
    this.context = context;
  }

  // Basic logging methods
  error(message: string, meta: Record<string, any> = {}): void {
    winstonLogger.error(message, { context: this.context, ...meta });
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    winstonLogger.warn(message, { context: this.context, ...meta });
  }

  info(message: string, meta: Record<string, any> = {}): void {
    winstonLogger.info(message, { context: this.context, ...meta });
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    winstonLogger.debug(message, { context: this.context, ...meta });
  }

  verbose(message: string, meta: Record<string, any> = {}): void {
    winstonLogger.verbose(message, { context: this.context, ...meta });
  }

  // Log with arbitrary level
  log(level: string, message: string, meta: Record<string, any> = {}): void {
    winstonLogger.log(level, message, { context: this.context, ...meta });
  }

  // Special methods for structured logging
  logRequest(req: any, meta: Record<string, any> = {}): void {
    const { method, url, headers, body, params, query } = req;
    this.info(`Request: ${method} ${url}`, {
      request: {
        method,
        url,
        headers,
        body,
        params,
        query,
      },
      ...meta,
    });
  }

  logResponse(res: any, meta: Record<string, any> = {}): void {
    const { statusCode, body } = res;
    this.info(`Response: ${statusCode}`, {
      response: {
        statusCode,
        body,
      },
      ...meta,
    });
  }

  // Error handling methods
  logError(error: Error, meta: Record<string, any> = {}): void {
    this.error(error.message, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...meta,
    });
  }

  // Transaction logging for blockchain operations
  logTransaction(txHash: string, status: string, details: Record<string, any> = {}): void {
    this.info(`Transaction ${status}: ${txHash}`, {
      transaction: {
        hash: txHash,
        status,
        ...details,
      },
    });
  }

  // Method to create a child logger with a different context
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`);
  }
}

// Export a default logger instance and the Logger class
export const logger = new Logger();
export default Logger;
