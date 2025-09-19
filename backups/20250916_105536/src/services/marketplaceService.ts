import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { gql, GraphQLClient } from 'graphql-request';
import config from '../config';
import Logger from '../utils/logger';

// Define collection types
export enum AxieCollection {
  ORIGIN_GEN0 = 'origin-gen0',
  SUMMER_2022 = 'summer-2022',
  NIGHTMARE = 'nightmare',
  CHRISTMAS = 'christmas',
  MEO_CORP = 'meo-corp',
  SHINY = 'shiny',
  JAPANESE = 'japanese',
  ORIGIN = 'origin',
  MYSTIC = 'mystic',
  REGULAR = 'regular' // Default collection for regular Axies
}

// Define part types
export enum AxiePartType {
  EYES = 'eyes',
  EARS = 'ears',
  MOUTH = 'mouth',
  HORN = 'horn',
  BACK = 'back',
  TAIL = 'tail'
}

// Define Axie classes
export enum AxieClass {
  BEAST = 'beast',
  AQUATIC = 'aquatic',
  PLANT = 'plant',
  BIRD = 'bird',
  BUG = 'bug',
  REPTILE = 'reptile',
  DAWN = 'dawn',
  DUSK = 'dusk',
  MECH = 'mech'
}

// Define interfaces for API responses
export interface AxiePart {
  id: string;
  name: string;
  class: AxieClass;
  type: AxiePartType;
  specialGenes?: string;
  stage?: number;
}

export interface AxieGenes {
  id: string;
  quality: number;
  purity: number;
  pureSixes: number; // Number of parts with 6/6 purity
  numMystic: number;
  class: AxieClass;
  region: string;
  pattern: string;
  color: string;
  eyes: AxiePart;
  ears: AxiePart;
  mouth: AxiePart;
  horn: AxiePart;
  back: AxiePart;
  tail: AxiePart;
}

export interface AxieOrder {
  id: string;
  maker: string;
  kind: string;
  assets: {
    erc: string;
    address: string;
    id: string;
    quantity: string;
    orderId: string;
  }[];
  expiredAt: number;
  paymentToken: string;
  startedAt: number;
  basePrice: string;
  endedAt: number;
  endedPrice: string;
  expectedState: string;
  nonce: string;
  marketFeePercentage: number;
  signature: string;
  hash: string;
  duration: number;
  timeLeft: number;
  currentPrice: string;
  currentPriceUsd: string;
  suggestedPrice: string;
  seller: string;
}

export interface Axie {
  id: string;
  name: string;
  image: string;
  class: AxieClass;
  breedCount: number;
  parts: AxiePart[];
  genes?: AxieGenes;
  owner: string;
  birthDate: number;
  bodyShape?: string;
  sireId?: string;
  matronId?: string;
  stage: number;
  title?: string;
  order?: AxieOrder;
  collection: AxieCollection;
}

export interface AxieListingResponse {
  total: number;
  results: Axie[];
}

export interface CollectionStats {
  collection: AxieCollection;
  floorPrice: number;
  floorPriceUsd: number;
  avg10Price: number;
  avg50Price: number;
  avg100Price: number;
  totalListed: number;
  timestamp: Date;
}

/**
 * Service for interacting with Axie Infinity Marketplace API
 */
class MarketplaceService {
  private logger: Logger;
  private graphqlClient: GraphQLClient;
  private backupGraphqlClient: GraphQLClient;
  private axiosClient: AxiosInstance;
  private lastRequestTime: number = 0;
  private requestQueue: Promise<any> = Promise.resolve();
  private cacheData: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTtl: number = 60 * 1000; // 1 minute default cache TTL
  
  // Collection mapping for API queries
  private collectionMapping: Record<AxieCollection, any> = {
    [AxieCollection.ORIGIN_GEN0]: { specialization: 'origin-gen0' },
    [AxieCollection.SUMMER_2022]: { specialization: 'summer-2022' },
    [AxieCollection.NIGHTMARE]: { specialization: 'nightmare' },
    [AxieCollection.CHRISTMAS]: { specialization: 'christmas' },
    [AxieCollection.MEO_CORP]: { specialization: 'meo-corp' },
    [AxieCollection.SHINY]: { specialization: 'shiny' },
    [AxieCollection.JAPANESE]: { specialization: 'japanese' },
    [AxieCollection.ORIGIN]: { specialization: 'origin' },
    [AxieCollection.MYSTIC]: { numMystic: { $gt: 0 } },
    [AxieCollection.REGULAR]: {} // No special criteria for regular Axies
  };

  /**
   * Constructor
   */
  constructor() {
    this.logger = new Logger('marketplace-service');
    
    // Initialize GraphQL clients
    this.graphqlClient = new GraphQLClient(config.api.axieGraphqlApi, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Axie-Sweep-Bot/1.0.0'
      }
    });
    
    this.backupGraphqlClient = new GraphQLClient(config.api.axieGraphqlApiBackup, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Axie-Sweep-Bot/1.0.0'
      }
    });
    
    // Initialize Axios client for REST API calls
    this.axiosClient = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Axie-Sweep-Bot/1.0.0'
      }
    });
    
    // Set cache TTL from config
    if (config.redis.enabled) {
      this.cacheTtl = config.redis.cacheTtl * 1000; // Convert to milliseconds
    }
    
    this.logger.info('Marketplace service initialized');
  }

  /**
   * Rate limiting function to ensure we don't exceed API limits
   * @returns Promise that resolves when it's safe to make another request
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minRequestInterval = 1000 / (config.api.maxRequestsPerMinute / 60); // Convert to requests per second
    
    if (timeSinceLastRequest < minRequestInterval) {
      const delay = minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Queue a request to ensure sequential execution with rate limiting
   * @param requestFn Function that makes the actual request
   * @returns Promise with the request result
   */
  private async queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    // Create a new promise that will be resolved when this request completes
    this.requestQueue = this.requestQueue
      .then(() => this.rateLimit())
      .then(requestFn)
      .catch(error => {
        this.logger.error('Error in queued request', { error });
        throw error;
      });
      
    return this.requestQueue as Promise<T>;
  }

  /**
   * Execute a GraphQL query with failover to backup endpoint
   * @param query GraphQL query
   * @param variables Query variables
   * @returns Query result
   */
  private async executeGraphQLQuery<T>(query: string, variables: any): Promise<T> {
    return this.queueRequest(async () => {
      try {
        // Try primary endpoint
        return await this.graphqlClient.request<T>(query, variables);
      } catch (error) {
        this.logger.warn('Primary GraphQL endpoint failed, trying backup', { error });
        
        try {
          // Try backup endpoint
          return await this.backupGraphqlClient.request<T>(query, variables);
        } catch (backupError) {
          this.logger.error('Both GraphQL endpoints failed', { error: backupError });
          throw new Error(`GraphQL query failed: ${(backupError as Error).message}`);
        }
      }
    });
  }

  /**
   * Get cached data or execute function to fetch new data
   * @param cacheKey Cache key
   * @param fetchFn Function to fetch data if not cached
   * @returns Cached or fresh data
   */
  private async getCachedOrFetch<T>(cacheKey: string, fetchFn: () => Promise<T>): Promise<T> {
    const cached = this.cacheData.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < this.cacheTtl) {
      this.logger.debug('Using cached data', { cacheKey });
      return cached.data as T;
    }
    
    // Fetch fresh data
    const data = await fetchFn();
    
    // Cache the result
    this.cacheData.set(cacheKey, { data, timestamp: now });
    
    return data;
  }

  /**
   * Get Axies from marketplace by collection
   * @param collection Collection type
   * @param options Search options
   * @returns Axie listing response
   */
  public async getAxiesByCollection(
    collection: AxieCollection,
    options: {
      from?: number;
      size?: number;
      sort?: 'PriceAsc' | 'PriceDesc' | 'IdAsc' | 'IdDesc';
      auctionType?: 'Sale' | 'All';
      maxPrice?: number;
      classes?: AxieClass[];
      pureness?: number;
      numMystic?: number;
      breedCount?: number | [number, number]; // Single value or range [min, max]
      parts?: string[]; // Part IDs
    } = {}
  ): Promise<AxieListingResponse> {
    const {
      from = 0,
      size = 100,
      sort = 'PriceAsc',
      auctionType = 'Sale',
      maxPrice,
      classes,
      pureness,
      numMystic,
      breedCount,
      parts
    } = options;
    
    // Build criteria object for the query
    const criteria: any = {
      ...this.collectionMapping[collection],
      from,
      size,
      sort,
      auctionType
    };
    
    // Add optional filters
    if (maxPrice) {
      criteria.priceRange = { max: maxPrice };
    }
    
    if (classes && classes.length > 0) {
      criteria.classes = classes;
    }
    
    if (pureness !== undefined) {
      criteria.pureness = pureness;
    }
    
    if (numMystic !== undefined && collection !== AxieCollection.MYSTIC) {
      criteria.numMystic = numMystic;
    }
    
    if (breedCount !== undefined) {
      if (Array.isArray(breedCount)) {
        criteria.breedCount = { $gte: breedCount[0], $lte: breedCount[1] };
      } else {
        criteria.breedCount = breedCount;
      }
    }
    
    if (parts && parts.length > 0) {
      criteria.parts = parts;
    }
    
    // Generate cache key
    const cacheKey = `axies:${collection}:${JSON.stringify(criteria)}`;
    
    return this.getCachedOrFetch<AxieListingResponse>(cacheKey, async () => {
      const query = gql`
        query GetAxies($criteria: AxieSearchCriteria) {
          axies(criteria: $criteria) {
            total
            results {
              id
              name
              image
              class
              breedCount
              parts {
                id
                name
                class
                type
              }
              owner
              birthDate
              stage
              order {
                id
                maker
                kind
                assets {
                  erc
                  address
                  id
                  quantity
                  orderId
                }
                expiredAt
                paymentToken
                startedAt
                basePrice
                endedAt
                endedPrice
                expectedState
                nonce
                marketFeePercentage
                signature
                hash
                duration
                timeLeft
                currentPrice
                currentPriceUsd
                suggestedPrice
                seller
              }
            }
          }
        }
      `;
      
      try {
        const response = await this.executeGraphQLQuery<{ axies: AxieListingResponse }>(query, { criteria });
        
        // Map the collection to each Axie for easier filtering later
        const axies = response.axies.results.map(axie => ({
          ...axie,
          collection
        }));
        
        return {
          total: response.axies.total,
          results: axies
        };
      } catch (error) {
        this.logger.error('Failed to get Axies by collection', { error, collection, criteria });
        throw new Error(`Failed to get Axies: ${(error as Error).message}`);
      }
    });
  }

  /**
   * Get detailed information for a specific Axie
   * @param axieId Axie ID
   * @returns Detailed Axie information
   */
  public async getAxieDetails(axieId: string): Promise<Axie> {
    const cacheKey = `axie:${axieId}`;
    
    return this.getCachedOrFetch<Axie>(cacheKey, async () => {
      const query = gql`
        query GetAxieDetail($axieId: ID!) {
          axie(axieId: $axieId) {
            id
            name
            image
            class
            breedCount
            parts {
              id
              name
              class
              type
              specialGenes
            }
            genes {
              id
              quality
              purity
              pureSixes
              numMystic
              class
              region
              pattern
              color
              eyes {
                id
                name
                class
                type
              }
              ears {
                id
                name
                class
                type
              }
              mouth {
                id
                name
                class
                type
              }
              horn {
                id
                name
                class
                type
              }
              back {
                id
                name
                class
                type
              }
              tail {
                id
                name
                class
                type
              }
            }
            owner
            birthDate
            bodyShape
            sireId
            matronId
            stage
            title
            order {
              id
              currentPrice
              currentPriceUsd
              maker
              kind
              seller
            }
          }
        }
      `;
      
      try {
        const response = await this.executeGraphQLQuery<{ axie: Axie }>(query, { axieId });
        
        // Determine collection based on Axie properties
        let collection = AxieCollection.REGULAR;
        
        if (response.axie.genes) {
          if (response.axie.genes.numMystic > 0) {
            collection = AxieCollection.MYSTIC;
          }
          
          // Check for other collections based on parts or other properties
          // This is a simplified version - actual implementation would need more detailed checks
          const specialization = response.axie.parts.find(part => part.specialGenes)?.specialGenes;
          
          if (specialization) {
            switch (specialization) {
              case 'origin-gen0':
                collection = AxieCollection.ORIGIN_GEN0;
                break;
              case 'summer-2022':
                collection = AxieCollection.SUMMER_2022;
                break;
              case 'nightmare':
                collection = AxieCollection.NIGHTMARE;
                break;
              case 'christmas':
                collection = AxieCollection.CHRISTMAS;
                break;
              case 'meo-corp':
                collection = AxieCollection.MEO_CORP;
                break;
              case 'shiny':
                collection = AxieCollection.SHINY;
                break;
              case 'japanese':
                collection = AxieCollection.JAPANESE;
                break;
              case 'origin':
                collection = AxieCollection.ORIGIN;
                break;
            }
          }
        }
        
        return {
          ...response.axie,
          collection
        };
      } catch (error) {
        this.logger.error('Failed to get Axie details', { error, axieId });
        throw new Error(`Failed to get Axie details: ${(error as Error).message}`);
      }
    });
  }

  /**
   * Get multiple Axies by IDs
   * @param axieIds Array of Axie IDs
   * @returns Array of Axies
   */
  public async getAxiesByIds(axieIds: string[]): Promise<Axie[]> {
    // Split into chunks of 20 to avoid large queries
    const chunkSize = 20;
    const chunks = [];
    
    for (let i = 0; i < axieIds.length; i += chunkSize) {
      chunks.push(axieIds.slice(i, i + chunkSize));
    }
    
    const results: Axie[] = [];
    
    // Process each chunk
    for (const chunk of chunks) {
      const query = gql`
        query GetAxiesByIds($axieIds: [ID!]!) {
          axies(axieIds: $axieIds) {
            results {
              id
              name
              image
              class
              breedCount
              parts {
                id
                name
                class
                type
              }
              owner
              birthDate
              stage
              order {
                currentPrice
                currentPriceUsd
                seller
              }
            }
          }
        }
      `;
      
      try {
        const response = await this.executeGraphQLQuery<{ axies: { results: Axie[] } }>(query, { axieIds: chunk });
        results.push(...response.axies.results);
      } catch (error) {
        this.logger.error('Failed to get Axies by IDs', { error, axieIds: chunk });
        throw new Error(`Failed to get Axies by IDs: ${(error as Error).message}`);
      }
    }
    
    return results;
  }

  /**
   * Calculate collection statistics
   * @param collection Collection type
   * @returns Collection statistics
   */
  public async getCollectionStats(collection: AxieCollection): Promise<CollectionStats> {
    const cacheKey = `stats:${collection}`;
    
    return this.getCachedOrFetch<CollectionStats>(cacheKey, async () => {
      try {
        // Get the cheapest 100 Axies in the collection
        const axies = await this.getAxiesByCollection(collection, {
          size: 100,
          sort: 'PriceAsc',
          auctionType: 'Sale'
        });
        
        if (axies.results.length === 0) {
          throw new Error(`No Axies found in collection: ${collection}`);
        }
        
        // Calculate floor price (cheapest Axie)
        const floorPrice = parseFloat(axies.results[0].order?.currentPrice || '0') / 1e18;
        const floorPriceUsd = parseFloat(axies.results[0].order?.currentPriceUsd || '0');
        
        // Calculate average prices
        const prices = axies.results
          .filter(axie => axie.order?.currentPrice)
          .map(axie => parseFloat(axie.order!.currentPrice) / 1e18);
        
        const avg10Price = this.calculateAverage(prices.slice(0, 10));
        const avg50Price = this.calculateAverage(prices.slice(0, 50));
        const avg100Price = this.calculateAverage(prices);
        
        return {
          collection,
          floorPrice,
          floorPriceUsd,
          avg10Price,
          avg50Price,
          avg100Price,
          totalListed: axies.total,
          timestamp: new Date()
        };
      } catch (error) {
        this.logger.error('Failed to get collection stats', { error, collection });
        throw new Error(`Failed to get collection stats: ${(error as Error).message}`);
      }
    });
  }

  /**
   * Get statistics for all collections
   * @returns Map of collection stats
   */
  public async getAllCollectionStats(): Promise<Map<AxieCollection, CollectionStats>> {
    const collections = Object.values(AxieCollection);
    const statsMap = new Map<AxieCollection, CollectionStats>();
    
    // Process collections in parallel with a concurrency limit
    const concurrencyLimit = 3;
    const chunks = [];
    
    for (let i = 0; i < collections.length; i += concurrencyLimit) {
      chunks.push(collections.slice(i, i + concurrencyLimit));
    }
    
    for (const chunk of chunks) {
      const promises = chunk.map(collection => 
        this.getCollectionStats(collection)
          .then(stats => statsMap.set(collection, stats))
          .catch(error => {
            this.logger.error(`Failed to get stats for collection: ${collection}`, { error });
            return null;
          })
      );
      
      await Promise.all(promises);
    }
    
    return statsMap;
  }

  /**
   * Find the cheapest Axies in a collection
   * @param collection Collection type
   * @param quantity Number of Axies to find
   * @param maxPrice Maximum price per Axie (in RON)
   * @returns Array of cheapest Axies
   */
  public async findCheapestAxies(
    collection: AxieCollection,
    quantity: number,
    maxPrice?: number
  ): Promise<Axie[]> {
    try {
      // Get more Axies than needed in case some are sold during the process
      const bufferFactor = 1.5;
      const bufferSize = Math.min(Math.ceil(quantity * bufferFactor), 100);
      
      const axies = await this.getAxiesByCollection(collection, {
        size: bufferSize,
        sort: 'PriceAsc',
        auctionType: 'Sale',
        maxPrice: maxPrice ? maxPrice * 1e18 : undefined // Convert to wei
      });
      
      if (axies.results.length === 0) {
        throw new Error(`No Axies found in collection: ${collection}${maxPrice ? ` under ${maxPrice} RON` : ''}`);
      }
      
      // Return the requested quantity or all available if less
      return axies.results.slice(0, quantity);
    } catch (error) {
      this.logger.error('Failed to find cheapest Axies', { error, collection, quantity, maxPrice });
      throw new Error(`Failed to find cheapest Axies: ${(error as Error).message}`);
    }
  }

  /**
   * Find Axies by specific criteria
   * @param criteria Search criteria
   * @returns Array of matching Axies
   */
  public async findAxiesByCriteria(criteria: {
    collection?: AxieCollection;
    classes?: AxieClass[];
    pureness?: number;
    numMystic?: number;
    breedCount?: number | [number, number];
    parts?: string[];
    maxPrice?: number;
    sort?: 'PriceAsc' | 'PriceDesc' | 'IdAsc' | 'IdDesc';
    from?: number;
    size?: number;
  }): Promise<AxieListingResponse> {
    const {
      collection = AxieCollection.REGULAR,
      classes,
      pureness,
      numMystic,
      breedCount,
      parts,
      maxPrice,
      sort = 'PriceAsc',
      from = 0,
      size = 100
    } = criteria;
    
    try {
      return await this.getAxiesByCollection(collection, {
        classes,
        pureness,
        numMystic,
        breedCount,
        parts,
        maxPrice: maxPrice ? maxPrice * 1e18 : undefined, // Convert to wei
        sort,
        from,
        size
      });
    } catch (error) {
      this.logger.error('Failed to find Axies by criteria', { error, criteria });
      throw new Error(`Failed to find Axies by criteria: ${(error as Error).message}`);
    }
  }

  /**
   * Save collection statistics to database
   * @param db Database connection
   * @param stats Collection statistics
   * @returns ID of the inserted record
   */
  public async saveCollectionStats(db: any, stats: CollectionStats): Promise<number> {
    try {
      const [id] = await db('price_history').insert({
        collection: stats.collection,
        floor_price: stats.floorPrice,
        avg_10: stats.avg10Price,
        avg_50: stats.avg50Price,
        avg_100: stats.avg100Price,
        total_listed: stats.totalListed,
        timestamp: stats.timestamp
      });
      
      this.logger.info('Saved collection stats to database', { collection: stats.collection, id });
      return id;
    } catch (error) {
      this.logger.error('Failed to save collection stats', { error, collection: stats.collection });
      throw new Error(`Failed to save collection stats: ${(error as Error).message}`);
    }
  }

  /**
   * Get historical statistics for a collection
   * @param db Database connection
   * @param collection Collection type
   * @param days Number of days of history to retrieve
   * @returns Array of historical stats
   */
  public async getHistoricalStats(
    db: any,
    collection: AxieCollection,
    days: number = 7
  ): Promise<CollectionStats[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const results = await db('price_history')
        .where({ collection })
        .where('timestamp', '>=', startDate)
        .orderBy('timestamp', 'asc')
        .select(
          'collection',
          'floor_price as floorPrice',
          'avg_10 as avg10Price',
          'avg_50 as avg50Price',
          'avg_100 as avg100Price',
          'total_listed as totalListed',
          'timestamp'
        );
      
      return results.map(row => ({
        ...row,
        floorPriceUsd: 0, // Historical USD prices not stored
        timestamp: new Date(row.timestamp)
      }));
    } catch (error) {
      this.logger.error('Failed to get historical stats', { error, collection, days });
      throw new Error(`Failed to get historical stats: ${(error as Error).message}`);
    }
  }

  /**
   * Get marketplace contract address
   * @returns Marketplace contract address
   */
  public getMarketplaceContractAddress(): string {
    return config.blockchain.marketplaceContractAddress;
  }

  /**
   * Get Axie contract address
   * @returns Axie contract address
   */
  public getAxieContractAddress(): string {
    return config.blockchain.axieContractAddress;
  }

  /**
   * Helper function to calculate average of an array of numbers
   * @param numbers Array of numbers
   * @returns Average value
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((acc, val) => acc + val, 0);
    return sum / numbers.length;
  }

  /**
   * Clear cache for a specific key or all cache if no key provided
   * @param key Optional cache key to clear
   */
  public clearCache(key?: string): void {
    if (key) {
      this.cacheData.delete(key);
      this.logger.debug('Cleared cache for key', { key });
    } else {
      this.cacheData.clear();
      this.logger.debug('Cleared all cache');
    }
  }
}

export default MarketplaceService;
