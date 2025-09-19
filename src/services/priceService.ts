// @ts-nocheck
import axios from 'axios';
import Logger from '../utils/logger';

/**
 * PriceService - Fetches and caches cryptocurrency prices
 * 
 * This service provides real-time ETH and RON prices from public APIs:
 * - Primary source: CoinGecko API (free, no auth required)
 * - Backup source: Binance API
 * 
 * Includes caching to avoid hitting rate limits.
 */
class PriceService {
  private logger: Logger;
  private cache: {
    ethPrice: number | null;
    ronPrice: number | null;
    lastUpdated: number;
  };
  private cacheValidityMs: number;
  private readonly DEFAULT_ETH_PRICE = 3000; // Fallback price if APIs fail
  private readonly DEFAULT_RON_PRICE = 2.5;  // Fallback RON price if APIs fail

  /**
   * Constructor
   * @param cacheValiditySeconds Cache validity in seconds (default: 60 seconds)
   */
  constructor(cacheValiditySeconds = 60) {
    this.logger = new Logger('price-service');
    this.cache = {
      ethPrice: null,
      ronPrice: null,
      lastUpdated: 0
    };
    this.cacheValidityMs = cacheValiditySeconds * 1000;
    
    this.logger.info('Price service initialized', {
      cacheValiditySeconds,
      defaultEthPrice: this.DEFAULT_ETH_PRICE,
      defaultRonPrice: this.DEFAULT_RON_PRICE
    });
  }

  /**
   * Get current ETH price in USD
   * Uses cache if available and not expired
   * @returns Current ETH price in USD
   */
  public async getEthPrice(): Promise<number> {
    try {
      // Check if cache is valid
      const now = Date.now();
      if (this.cache.ethPrice && (now - this.cache.lastUpdated) < this.cacheValidityMs) {
        this.logger.debug('Using cached ETH price', { 
          price: this.cache.ethPrice,
          cacheAge: (now - this.cache.lastUpdated) / 1000
        });
        return this.cache.ethPrice;
      }

      // Try to fetch from primary source (CoinGecko)
      try {
        const price = await this.fetchEthFromCoinGecko();
        this.updateCache('eth', price);
        return price;
      } catch (error) {
        this.logger.warn('Failed to fetch ETH price from CoinGecko, trying Binance', { error });
        
        // Try backup source (Binance)
        try {
          const price = await this.fetchEthFromBinance();
          this.updateCache('eth', price);
          return price;
        } catch (backupError) {
          this.logger.error('Failed to fetch ETH price from backup source', { error: backupError });
          
          // If we have a cached price (even if expired), use it as last resort
          if (this.cache.ethPrice) {
            this.logger.warn('Using expired cache as fallback', { price: this.cache.ethPrice });
            return this.cache.ethPrice;
          }
          
          // Otherwise use default price
          this.logger.warn('Using default ETH price', { price: this.DEFAULT_ETH_PRICE });
          return this.DEFAULT_ETH_PRICE;
        }
      }
    } catch (error) {
      this.logger.error('Unexpected error in getEthPrice', { error });
      return this.DEFAULT_ETH_PRICE;
    }
  }

  /**
   * Get current RON price in USD
   * Uses cache if available and not expired
   * @returns Current RON price in USD
   */
  public async getRonPrice(): Promise<number> {
    try {
      // Check if cache is valid
      const now = Date.now();
      if (this.cache.ronPrice && (now - this.cache.lastUpdated) < this.cacheValidityMs) {
        this.logger.debug('Using cached RON price', { 
          price: this.cache.ronPrice,
          cacheAge: (now - this.cache.lastUpdated) / 1000
        });
        return this.cache.ronPrice;
      }

      // Try to fetch from primary source (CoinGecko)
      try {
        const price = await this.fetchRonFromCoinGecko();
        this.updateCache('ron', price);
        return price;
      } catch (error) {
        this.logger.warn('Failed to fetch RON price from CoinGecko, trying Binance', { error });
        
        // Try backup source (Binance)
        try {
          const price = await this.fetchRonFromBinance();
          this.updateCache('ron', price);
          return price;
        } catch (backupError) {
          this.logger.error('Failed to fetch RON price from backup source', { error: backupError });
          
          // If we have a cached price (even if expired), use it as last resort
          if (this.cache.ronPrice) {
            this.logger.warn('Using expired cache as fallback', { price: this.cache.ronPrice });
            return this.cache.ronPrice;
          }
          
          // Otherwise use default price
          this.logger.warn('Using default RON price', { price: this.DEFAULT_RON_PRICE });
          return this.DEFAULT_RON_PRICE;
        }
      }
    } catch (error) {
      this.logger.error('Unexpected error in getRonPrice', { error });
      return this.DEFAULT_RON_PRICE;
    }
  }

  /**
   * Convert ETH amount to USD
   * @param ethAmount Amount in ETH
   * @returns Equivalent amount in USD
   */
  public async ethToUsd(ethAmount: number): Promise<number> {
    const ethPrice = await this.getEthPrice();
    return ethAmount * ethPrice;
  }

  /**
   * Convert RON amount to USD
   * @param ronAmount Amount in RON
   * @returns Equivalent amount in USD
   */
  public async ronToUsd(ronAmount: number): Promise<number> {
    const ronPrice = await this.getRonPrice();
    return ronAmount * ronPrice;
  }

  /**
   * Format ETH amount with USD value
   * @param ethAmount Amount in ETH
   * @param ethDecimals Decimal places for ETH (default: 7)
   * @param usdDecimals Decimal places for USD (default: 2)
   * @returns Formatted string like "0.0012500 ETH ($3.75)"
   */
  public async formatEthWithUsd(
    ethAmount: number, 
    ethDecimals = 7, 
    usdDecimals = 2
  ): Promise<string> {
    const usdAmount = await this.ethToUsd(ethAmount);
    return `${ethAmount.toFixed(ethDecimals)} ETH ($${usdAmount.toFixed(usdDecimals)})`;
  }

  /**
   * Format RON amount with USD value
   * @param ronAmount Amount in RON
   * @param ronDecimals Decimal places for RON (default: 6)
   * @param usdDecimals Decimal places for USD (default: 2)
   * @returns Formatted string like "10.500000 RON ($26.25)"
   */
  public async formatRonWithUsd(
    ronAmount: number, 
    ronDecimals = 6, 
    usdDecimals = 2
  ): Promise<string> {
    const usdAmount = await this.ronToUsd(ronAmount);
    return `${ronAmount.toFixed(ronDecimals)} RON ($${usdAmount.toFixed(usdDecimals)})`;
  }

  /**
   * Fetch ETH price from CoinGecko API
   * @returns ETH price in USD
   * @throws Error if fetch fails
   */
  private async fetchEthFromCoinGecko(): Promise<number> {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
    
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data && response.data.ethereum && response.data.ethereum.usd) {
      const price = parseFloat(response.data.ethereum.usd);
      this.logger.info('Fetched ETH price from CoinGecko', { price });
      return price;
    }
    
    throw new Error('Invalid response from CoinGecko API');
  }

  /**
   * Fetch RON price from CoinGecko API
   * @returns RON price in USD
   * @throws Error if fetch fails
   */
  private async fetchRonFromCoinGecko(): Promise<number> {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ronin&vs_currencies=usd';
    
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data && response.data.ronin && response.data.ronin.usd) {
      const price = parseFloat(response.data.ronin.usd);
      this.logger.info('Fetched RON price from CoinGecko', { price });
      return price;
    }
    
    throw new Error('Invalid response from CoinGecko API for RON');
  }

  /**
   * Fetch ETH price from Binance API
   * @returns ETH price in USD
   * @throws Error if fetch fails
   */
  private async fetchEthFromBinance(): Promise<number> {
    const url = 'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT';
    
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data && response.data.price) {
      const price = parseFloat(response.data.price);
      this.logger.info('Fetched ETH price from Binance', { price });
      return price;
    }
    
    throw new Error('Invalid response from Binance API');
  }

  /**
   * Fetch RON price from Binance API
   * @returns RON price in USD
   * @throws Error if fetch fails
   */
  private async fetchRonFromBinance(): Promise<number> {
    const url = 'https://api.binance.com/api/v3/ticker/price?symbol=RONUSDT';
    
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data && response.data.price) {
      const price = parseFloat(response.data.price);
      this.logger.info('Fetched RON price from Binance', { price });
      return price;
    }
    
    throw new Error('Invalid response from Binance API for RON');
  }

  /**
   * Update price cache
   * @param token Token type ('eth' or 'ron')
   * @param price New price
   */
  private updateCache(token: 'eth' | 'ron', price: number): void {
    if (token === 'eth') {
      this.cache.ethPrice = price;
    } else {
      this.cache.ronPrice = price;
    }
    this.cache.lastUpdated = Date.now();
    this.logger.debug(`Updated ${token.toUpperCase()} price cache`, { price, timestamp: this.cache.lastUpdated });
  }
}

// Export singleton instance
const priceService = new PriceService();
export default priceService;
