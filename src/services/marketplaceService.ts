// @ts-nocheck
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
  MEO_CORP_II = 'meo-corp-2',
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

/**
 * Order information returned by the Axie Infinity marketplace GraphQL API.
 * NOTE: These fields reflect the actual schema discovered via field-discovery
 * scripts (`currentPrice`, `duration`, `timeLeft`, `maker`, etc.).
 */
export interface AxieOrder {
  currentPrice: string;
  duration: number;
  timeLeft: number;
  maker: string;          // Seller address
  paymentToken: string;
  basePrice: string;
  endedPrice: string;
  status: string;
  expiredAt: number;
  hash: string;
  signature: string;
  nonce?: number;
  expectedState?: number;
  // Optional raw signed order bytes if exposed by API
  orderData?: string;
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
  
  // Collection mapping for API queries - Updated to use correct field names
  private collectionMapping: Record<AxieCollection, any> = {
    // Origin Gen 0 - Using title array with Origin
    [AxieCollection.ORIGIN_GEN0]: { 
      title: ['Origin'],
      breedCount: 0 // Gen 0 has breed count 0
    },
    // Summer 2022 - No specific title available, may need additional criteria
    [AxieCollection.SUMMER_2022]: { 
      /*
       * Collection axies that contain between 1-6 Summer parts.
       * Works directly via the public GraphQL API.
       */
      numSummer: [1, 2, 3, 4, 5, 6]
    },
    // Nightmare - No specific title available, may need additional criteria
    [AxieCollection.NIGHTMARE]: { 
      /*
       * Nightmare collection (1-6 Nightmare parts).
       */
      numNightmare: [1, 2, 3, 4, 5, 6]
    },
    // Christmas - No specific title available, may need additional criteria
    [AxieCollection.CHRISTMAS]: { 
      /*
       * Christmas collection (1-6 Xmas parts).
       */
      numXmas: [1, 2, 3, 4, 5, 6]
    },
    // MEO Corp - Using title array with MEO Corp
    [AxieCollection.MEO_CORP]: { 
      title: ['MEO Corp'] 
    },
    // MEO Corp II - Using title array with MEO Corp II
    [AxieCollection.MEO_CORP_II]: { 
      title: ['MEO Corp II'] 
    },
    // Shiny - No specific title available, may need additional criteria
    [AxieCollection.SHINY]: { 
      /*
       * Shiny collection (1-6 Shiny parts).
       */
      numShiny: [1, 2, 3, 4, 5, 6]
    },
    // Japanese - No specific title available, may need additional criteria
    [AxieCollection.JAPANESE]: { 
      /*
       * Japanese collection (1-6 Japan parts).
       */
      numJapan: [1, 2, 3, 4, 5, 6]
    },
    // Origin - Using title array with Origin
    [AxieCollection.ORIGIN]: { 
      title: ['Origin'] 
    },
    // Mystic - Using numMystic range [1, 4]
    [AxieCollection.MYSTIC]: { 
      numMystic: [1, 4] 
    },
    // Regular - No special criteria
    [AxieCollection.REGULAR]: {} 
  };

  /**
   * Constructor
   */
  constructor() {
    this.logger = new Logger('marketplace-service');
    
    /*
     * ------------------------------------------------------------------
     * GraphQL client configuration
     *  - Add richer headers (Origin / Accept) to bypass Cloudflare checks
     *  - Attach X-API-KEY automatically if configured
     * ------------------------------------------------------------------
     */
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Axie-Sweep-Bot/1.0.0',
      'Origin': 'https://axieinfinity.com'
    };

    // Primary GraphQL client (may require API-KEY)
    const primaryHeaders = { ...baseHeaders };
    if (config.api.axieGraphqlApiKey) {
      primaryHeaders['X-API-KEY'] = config.api.axieGraphqlApiKey;
      this.logger.debug('Using X-API-KEY for primary GraphQL endpoint');
    }

    // Initialize GraphQL clients with enhanced headers
    this.graphqlClient = new GraphQLClient(config.api.axieGraphqlApi, {
      headers: primaryHeaders
    });
    
    this.backupGraphqlClient = new GraphQLClient(config.api.axieGraphqlApiBackup, {
      headers: baseHeaders
    });

    // Log the endpoints being used (helps debugging which one is active)
    this.logger.info('Marketplace service initialized', {
      primaryEndpoint: config.api.axieGraphqlApi,
      backupEndpoint: config.api.axieGraphqlApiBackup
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
        // If schema parsing error due to unsupported field (e.g. orderData), retry without it
        try {
          const errJson = JSON.stringify((error as any)?.response || (error as any) || {});
          if (errJson.includes('no field `orderData`') || errJson.includes('Unknown field') || errJson.includes('PARSING_ERROR')) {
            const queryWithoutOrderData = query
              .split('\n')
              .filter(line => !line.includes('orderData'))
              .join('\n');
            try {
              return await this.graphqlClient.request<T>(queryWithoutOrderData, variables);
            } catch (_) {
              // fall through to backup
            }
          }
        } catch (_) {}
        
        try {
          // Try backup endpoint
          return await this.backupGraphqlClient.request<T>(query, variables);
        } catch (backupError) {
          // Final attempt: if the error is schema-related, try removing unsupported fields and retry backup
          try {
            const errJson = JSON.stringify((backupError as any)?.response || (backupError as any) || {});
            if (errJson.includes('no field `orderData`') || errJson.includes('Unknown field') || errJson.includes('PARSING_ERROR')) {
              const queryWithoutOrderData = query
                .split('\n')
                .filter(line => !line.includes('orderData'))
                .join('\n');
              return await this.backupGraphqlClient.request<T>(queryWithoutOrderData, variables);
            }
          } catch (_) {}
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
      ...this.collectionMapping[collection]
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
    const cacheKey = `axies:${collection}:${JSON.stringify(criteria)}:${from}:${size}:${sort}:${auctionType}`;
    
    return this.getCachedOrFetch<AxieListingResponse>(cacheKey, async () => {
      // This is the actual Axie Infinity GraphQL query for marketplace listings
      const query = gql`
        query GetAxieBriefList(
          $auctionType: AuctionType
          $criteria: AxieSearchCriteria
          $from: Int
          $sort: SortBy
          $size: Int
          $owner: String
        ) {
          axies(
            auctionType: $auctionType
            criteria: $criteria
            from: $from
            sort: $sort
            size: $size
            owner: $owner
          ) {
            total
            results {
              id
              name
              stage
              class
              breedCount
              image
              title
              battleInfo {
                banned
              }
              order {
                currentPrice
                duration
                timeLeft
                maker
                paymentToken
                basePrice
                endedPrice
                status
                expiredAt
                hash
                expectedState
                nonce
                signature
                # Some gateways expose raw bytes under different names; include if present
                orderData
              }
              parts {
                id
                name
                class
                type
                specialGenes
              }
              stats {
                hp
                speed
                skill
                morale
              }
            }
          }
        }
      `;
      
      try {
        const variables = {
          auctionType,
          criteria,
          from,
          sort,
          size
        };
        
        const response = await this.executeGraphQLQuery<{ axies: any }>(query, variables);
        
        // Transform the response to match our interface
        const results = response.axies.results.map(axie => ({
          id: axie.id,
          name: axie.name || `Axie #${axie.id}`,
          image: `https://axiecdn.axieinfinity.com/axies/${axie.id}/axie/axie-full-transparent.png`,
          class: axie.class,
          breedCount: axie.breedCount,
          parts: axie.parts,
          owner: axie.order?.maker || '',
          birthDate: 0, // Not provided in brief list
          stage: axie.stage,
          title: axie.title,
          // Map order data to our order interface
          order: axie.order ? {
            currentPrice: axie.order.currentPrice,
            duration: axie.order.duration,
            timeLeft: axie.order.timeLeft,
            maker: axie.order.maker,
            paymentToken: axie.order.paymentToken,
            basePrice: axie.order.basePrice,
            endedPrice: axie.order.endedPrice,
            status: axie.order.status,
            expiredAt: axie.order.expiredAt,
            hash: axie.order.hash,
            signature: axie.order.signature,
            expectedState: axie.order.expectedState,
            nonce: axie.order.nonce,
            orderData: axie.order.orderData
          } : undefined,
          collection
        }));
        
        return {
          total: response.axies.total,
          results
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
      // This is the actual Axie Infinity GraphQL query for detailed Axie information
      const query = gql`
        query GetAxieDetail($axieId: ID!) {
          axie(axieId: $axieId) {
            id
            name
            image
            class
            chain
            genes
            owner
            birthDate
            bodyShape
            sireId
            matronId
            stage
            title
            breedCount
            # level, figure removed – not in schema
            parts {
              id
              name
              class
              type
              specialGenes
            }
            stats {
              hp
              speed
              skill
              morale
            }
            order {
              currentPrice
              duration
              timeLeft
              maker
              paymentToken
              basePrice
              endedPrice
              status
              expiredAt
              hash
              expectedState
            nonce
              signature
            }
            # Removed battleInfo, children, potentialPoints – not in schema
          }
        }
      `;
      
      try {
        const response = await this.executeGraphQLQuery<{ axie: any }>(query, { axieId });
        
        // Determine collection based on Axie properties
        let collection = AxieCollection.REGULAR;
        
        // Check for special genes to determine collection
        const hasSpecialGenes = response.axie.parts.some(part => part.specialGenes);
        
        if (hasSpecialGenes) {
          // Check first part with special genes to determine collection
          const specialPart = response.axie.parts.find(part => part.specialGenes);
          if (specialPart) {
            switch (specialPart.specialGenes) {
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
        } else if (response.axie.genes) {
          // Check for mystic genes
          // Note: This is a simplified check, actual implementation would parse genes
          const genesHex = response.axie.genes;
          // Simplified mystic check - in a real implementation, we would parse the genes properly
          const isMystic = false; // Placeholder for actual gene parsing
          if (isMystic) {
            collection = AxieCollection.MYSTIC;
          }
        }
        
        // Transform response to match our interface
        return {
          id: response.axie.id,
          name: response.axie.name || `Axie #${response.axie.id}`,
          image: `https://axiecdn.axieinfinity.com/axies/${response.axie.id}/axie/axie-full-transparent.png`,
          class: response.axie.class,
          breedCount: response.axie.breedCount,
          parts: response.axie.parts,
          owner: response.axie.owner,
          birthDate: response.axie.birthDate,
          bodyShape: response.axie.bodyShape,
          sireId: response.axie.sireId,
          matronId: response.axie.matronId,
          stage: response.axie.stage,
          title: response.axie.title,
          // Map order data to our order interface
          order: response.axie.order ? {
            currentPrice: response.axie.order.currentPrice,
            duration: response.axie.order.duration,
            timeLeft: response.axie.order.timeLeft,
            maker: response.axie.order.maker,
            paymentToken: response.axie.order.paymentToken,
            basePrice: response.axie.order.basePrice,
            endedPrice: response.axie.order.endedPrice,
            status: response.axie.order.status,
            expiredAt: response.axie.order.expiredAt,
            hash: response.axie.order.hash,
            signature: response.axie.order.signature,
            expectedState: response.axie.order.expectedState,
            nonce: response.axie.order.nonce
          } : undefined,
          collection
        };
      } catch (error) {
        this.logger.error('Failed to get Axie details', { error, axieId });
        throw new Error(`Failed to get Axie details: ${(error as Error).message}`);
      }
    });
  }

  /**
   * Get the latest Axies listed on the marketplace
   * @param options Search options
   * @returns Axie listing response
   */
  public async getAxieLatest(
    options: {
      from?: number;
      size?: number;
      sort?: 'Latest' | 'PriceAsc' | 'PriceDesc';
      auctionType?: 'Sale' | 'All';
      classes?: AxieClass[];
    } = {}
  ): Promise<AxieListingResponse> {
    const {
      from = 0,
      size = 20,
      sort = 'Latest',
      auctionType = 'Sale',
      classes
    } = options;
    
    // Build criteria object for the query
    const criteria: any = {};
    
    // Add optional filters
    if (classes && classes.length > 0) {
      criteria.classes = classes;
    }
    
    // Generate cache key
    const cacheKey = `axies:latest:${JSON.stringify(criteria)}:${from}:${size}:${sort}:${auctionType}`;
    
    return this.getCachedOrFetch<AxieListingResponse>(cacheKey, async () => {
      // This is the actual Axie Infinity GraphQL query for latest listings
      const query = gql`
        query GetAxieLatest(
          $auctionType: AuctionType
          $criteria: AxieSearchCriteria
          $from: Int
          $sort: SortBy
          $size: Int
        ) {
          axies(
            auctionType: $auctionType
            criteria: $criteria
            from: $from
            sort: $sort
            size: $size
          ) {
            total
            results {
              id
              name
              stage
              class
              breedCount
              image
              title
              order {
                currentPrice
                duration
                timeLeft
                maker
                paymentToken
                basePrice
                endedPrice
                status
                expiredAt
                hash
                expectedState
                nonce
                signature
              }
              parts {
                id
                name
                class
                type
                specialGenes
              }
            }
          }
        }
      `;
      
      try {
        const variables = {
          auctionType,
          criteria,
          from,
          sort,
          size
        };
        
        const response = await this.executeGraphQLQuery<{ axies: any }>(query, variables);
        
        // Transform the response to match our interface
        const results = response.axies.results.map(axie => {
          // Determine collection based on parts
          let collection = AxieCollection.REGULAR;
          const hasSpecialGenes = axie.parts.some(part => part.specialGenes);
          
          if (hasSpecialGenes) {
            const specialPart = axie.parts.find(part => part.specialGenes);
            if (specialPart) {
              switch (specialPart.specialGenes) {
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
            id: axie.id,
            name: axie.name || `Axie #${axie.id}`,
            image: `https://axiecdn.axieinfinity.com/axies/${axie.id}/axie/axie-full-transparent.png`,
            class: axie.class,
            breedCount: axie.breedCount,
            parts: axie.parts,
            owner: axie.order?.maker || '',
            birthDate: 0, // Not provided in latest list
            stage: axie.stage,
            title: axie.title,
            // Map order data to our order interface
            order: axie.order ? {
              currentPrice: axie.order.currentPrice,
              duration: axie.order.duration,
              timeLeft: axie.order.timeLeft,
              maker: axie.order.maker,
              paymentToken: axie.order.paymentToken,
              basePrice: axie.order.basePrice,
              endedPrice: axie.order.endedPrice,
              status: axie.order.status,
              expiredAt: axie.order.expiredAt,
              hash: axie.order.hash,
              signature: axie.order.signature,
              expectedState: axie.order.expectedState,
              nonce: axie.order.nonce
            } : undefined,
            collection
          };
        });
        
        return {
          total: response.axies.total,
          results
        };
      } catch (error) {
        this.logger.error('Failed to get latest Axies', { error, criteria });
        throw new Error(`Failed to get latest Axies: ${(error as Error).message}`);
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
                specialGenes
              }
              owner
              birthDate
              stage
              order {
                currentPrice
                duration
                timeLeft
                maker
                paymentToken
                basePrice
                endedPrice
                status
                expiredAt
                hash
              expectedState
                nonce
                signature
              }
            }
          }
        }
      `;
      
      try {
        const response = await this.executeGraphQLQuery<{ axies: { results: any[] } }>(query, { axieIds: chunk });
        
        // Transform the response to match our interface
        const transformedResults = response.axies.results.map(axie => {
          // Determine collection based on parts
          let collection = AxieCollection.REGULAR;
          const hasSpecialGenes = axie.parts.some(part => part.specialGenes);
          
          if (hasSpecialGenes) {
            const specialPart = axie.parts.find(part => part.specialGenes);
            if (specialPart) {
              switch (specialPart.specialGenes) {
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
            id: axie.id,
            name: axie.name || `Axie #${axie.id}`,
            image: `https://axiecdn.axieinfinity.com/axies/${axie.id}/axie/axie-full-transparent.png`,
            class: axie.class,
            breedCount: axie.breedCount,
            parts: axie.parts,
            owner: axie.owner,
            birthDate: axie.birthDate,
            stage: axie.stage,
            // Map order data to our order interface
            order: axie.order ? {
              currentPrice: axie.order.currentPrice,
              duration: axie.order.duration,
              timeLeft: axie.order.timeLeft,
              maker: axie.order.maker,
              paymentToken: axie.order.paymentToken,
              basePrice: axie.order.basePrice,
              endedPrice: axie.order.endedPrice,
              status: axie.order.status,
              expiredAt: axie.order.expiredAt,
              hash: axie.order.hash,
              signature: axie.order.signature,
              expectedState: axie.order.expectedState,
              nonce: axie.order.nonce
            } : undefined,
            collection
          };
        });
        
        results.push(...transformedResults);
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
        
        // Calculate USD price (not available in new API, set to 0)
        const floorPriceUsd = 0;
        
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

  /**
   * Get Axies owned by a specific wallet address
   * @param ownerAddress Wallet address
   * @param from Starting index
   * @param size Number of results
   * @returns Array of Axies owned by the wallet
   */
  public async getAxiesByOwner(
    ownerAddress: string,
    from: number = 0,
    size: number = 100
  ): Promise<Axie[]> {
    try {
      // Convert address to 0x format if needed
      const normalizedAddress = ownerAddress.startsWith('ronin:')
        ? '0x' + ownerAddress.substring(6)
        : ownerAddress;
      
      // Query for Axies owned by the address
      const query = gql`
        query GetAxiesByOwner(
          $owner: String!
          $from: Int
          $size: Int
        ) {
          axies(
            owner: $owner
            from: $from
            size: $size
          ) {
            total
            results {
              id
              name
              stage
              class
              breedCount
              image
              title
              genes
              newGenes
              parts {
                id
                name
                class
                type
                specialGenes
              }
            }
          }
        }
      `;
      
      const variables = {
        owner: normalizedAddress,
        from,
        size
      };
      
      const response = await this.graphqlClient.request<any>(query, variables);
      
      if (!response || !response.axies || !response.axies.results) {
        this.logger.warn('No Axies found for owner', { ownerAddress });
        return [];
      }
      
      // Map results & back‐fill collection field (not provided by API)
      return response.axies.results.map((axie: any) => {
        // Default collection
        let collection = AxieCollection.REGULAR;

        /* ------------------------------------------------------------------
         * 1. Infer collection from `title` when possible
         * ---------------------------------------------------------------- */
        if (axie.title) {
          if (axie.title.includes('Origin')) {
            collection = axie.breedCount === 0
              ? AxieCollection.ORIGIN_GEN0
              : AxieCollection.ORIGIN;
          } else if (axie.title.includes('MEO Corp II')) {
            collection = AxieCollection.MEO_CORP_II;
          } else if (axie.title.includes('MEO Corp')) {
            collection = AxieCollection.MEO_CORP;
          }
        }

        /* ------------------------------------------------------------------
         * 2. Check parts for specialGenes flag
         * ---------------------------------------------------------------- */
        if (axie.parts && axie.parts.length > 0) {
          const specialPart = axie.parts.find((p: any) => p.specialGenes);
          if (specialPart?.specialGenes) {
            switch (specialPart.specialGenes) {
              case 'summer-2022':
                collection = AxieCollection.SUMMER_2022;
                break;
              case 'nightmare':
                collection = AxieCollection.NIGHTMARE;
                break;
              case 'christmas':
                collection = AxieCollection.CHRISTMAS;
                break;
              case 'shiny':
                collection = AxieCollection.SHINY;
                break;
              case 'japanese':
                collection = AxieCollection.JAPANESE;
                break;
              case 'origin':
                // Only override if not already set as GEN0
                if (collection !== AxieCollection.ORIGIN_GEN0) {
                  collection = AxieCollection.ORIGIN;
                }
                break;
              default:
                break;
            }
          }
        }

        return {
          ...axie,
          collection
        };
      });
    } catch (error) {
      this.logger.error('Failed to get Axies by owner', { error, ownerAddress });
      throw error;
    }
  }
}

export default MarketplaceService;
