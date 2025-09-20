// @ts-nocheck
import { ethers } from 'ethers';
import { Knex } from 'knex';
import config from '../config';
import Logger from '../utils/logger';
import MarketplaceService, { Axie, AxieCollection } from './marketplaceService';
import WalletService from './walletService';
import TokenService from './tokenService';
import { MARKETPLACE_ABI } from '../contracts/abis';
import MarketGatewayContract, { Erc721Order, OrderKind, OrderAssetItem, SettleOrderParams } from '../contracts/marketGateway';

// Interface for sweep options
export interface SweepOptions {
  userId: number;
  walletId: number;
  collection: AxieCollection;
  quantity: number;
  maxPrice?: number;
  classes?: string[];
  parts?: string[];
  pureness?: number;
  breedCount?: number | [number, number];
}

// Interface for purchase transaction
export interface PurchaseTransaction {
  txHash: string;
  userId: number;
  walletId: number;
  collection: AxieCollection;
  axieIds: string[];
  totalAmount: number;
  gasUsed?: number;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Interface for sweep result
export interface SweepResult {
  success: boolean;
  transaction?: PurchaseTransaction;
  purchasedAxies: Axie[];
  failedAxies: Axie[];
  totalSpent: number;
  gasUsed?: number;
  /** raw transaction hash even if DB save failed */
  txHash?: string;
  error?: string;
}

// Interface for sweep preview
export interface SweepPreview {
  collection: AxieCollection;
  quantity: number;
  axiesToPurchase: Axie[];
  totalCost: number;
  averagePrice: number;
  estimatedGasCost: number;
  totalWithGas: number;
}

/**
 * Service for executing Axie sweeps (bulk purchases)
 */
class SweepService {
  private logger: Logger;
  private marketplaceService: MarketplaceService;
  private walletService: WalletService;
  private tokenService: TokenService;
  private provider: ethers.JsonRpcProvider;

  /**
   * Axie IDs that must be excluded from sweeps.  These are usually
   * recently-sold Axies that still appear in the marketplace API but
   * will always revert when we try to buy them.
   *
   * Populate this list manually or via the addExcludedAxies() helper.
   */
  private readonly excludedAxieIds: Set<string> = new Set([
    // '12345678', '87654321'  // <- example placeholders
  ]);
  
  /**
   * Constructor
   */
  constructor() {
    this.logger = new Logger('sweep-service');
    this.marketplaceService = new MarketplaceService();
    this.walletService = new WalletService();
    this.tokenService = new TokenService();
    /**
     * Initialise a provider for the Ronin main-net.
     * Passing an explicit `network` object avoids ethers attempting an
     * auto-detect (which fails and spams "failed to detect network" logs).
     */
    this.provider = new ethers.JsonRpcProvider(
      config.blockchain.roninMainnetRpc,
      {
        chainId: 2020,    // Ronin chain-id
        name: 'ronin'
      }
    );
    
    this.logger.info('Sweep service initialized');
  }

  /**
   * Validate sweep options
   * @param options Sweep options
   * @throws Error if options are invalid
   */
  public validateSweepOptions(options: SweepOptions): void {
    // Check quantity
    if (options.quantity <= 0) {
      throw new Error('Quantity must be greater than 0');
    }
    
    if (options.quantity > config.security.maxSweepQuantity) {
      throw new Error(`Quantity cannot exceed ${config.security.maxSweepQuantity}`);
    }
    
    // Check max price
    if (options.maxPrice !== undefined && options.maxPrice <= 0) {
      throw new Error('Max price must be greater than 0');
    }
    
    // Check breed count range if provided
    if (Array.isArray(options.breedCount)) {
      if (options.breedCount[0] < 0 || options.breedCount[1] < 0 || options.breedCount[0] > options.breedCount[1]) {
        throw new Error('Invalid breed count range');
      }
    } else if (options.breedCount !== undefined && (options.breedCount < 0 || options.breedCount > 7)) {
      throw new Error('Breed count must be between 0 and 7');
    }
    
    // Check pureness
    if (options.pureness !== undefined && (options.pureness < 0 || options.pureness > 6)) {
      throw new Error('Pureness must be between 0 and 6');
    }
    
    this.logger.info('Sweep options validated', { options });
  }

  /**
   * Generate a preview of the sweep
   * @param db Database connection
   * @param options Sweep options
   * @returns Sweep preview
   */
  public async generateSweepPreview(db: Knex, options: SweepOptions): Promise<SweepPreview> {
    try {
      this.validateSweepOptions(options);
      
      // Find Axies to purchase
      const axiesToPurchase = await this.findAxiesToPurchase(options);
      
      if (axiesToPurchase.length === 0) {
        throw new Error('No Axies found matching the criteria');
      }
      
      // Calculate total and average costs
      const totalCost = this.calculateTotalCost(axiesToPurchase);
      const averagePrice = totalCost / axiesToPurchase.length;
      
      // Estimate gas cost
      const estimatedGasCost = await this.estimateGasCost(axiesToPurchase.length);
      
      return {
        collection: options.collection,
        quantity: axiesToPurchase.length,
        axiesToPurchase,
        totalCost,
        averagePrice,
        estimatedGasCost,
        totalWithGas: totalCost + estimatedGasCost
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to generate sweep preview', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        options 
      });
      throw error;
    }
  }

  /**
   * Find Axies to purchase based on options
   * @param options Sweep options
   * @returns Array of Axies to purchase
   */
  private async findAxiesToPurchase(options: SweepOptions): Promise<Axie[]> {
    try {
      const { collection, quantity, maxPrice, classes, parts, pureness, breedCount } = options;
      
      // Convert classes to proper enum values if provided
      const classEnums = classes?.map(c => c.toLowerCase() as any) || undefined;
      
      // Find Axies matching criteria
      const axies = await this.marketplaceService.findAxiesByCriteria({
        collection,
        classes: classEnums,
        parts,
        pureness,
        breedCount,
        maxPrice,
        sort: 'PriceAsc',
        size: quantity
      });
      
      // Diagnostic – how many items did we receive
      // Promote to INFO so it's visible without enabling DEBUG
      this.logger.info('Marketplace results received', {
        totalReturned: axies.results.length,
        collection,
        quantityRequested: quantity
      });

      // ------------------------------------------------------------------
      // Extra diagnostics: inspect the structure of the very first order
      // so we can see what fields the API is actually returning.  This
      // information makes it easier to fine-tune subsequent filters.
      // ------------------------------------------------------------------
      if (axies.results.length > 0 && axies.results[0].order) {
        this.logger.info('Sample order structure', {
          axieId: axies.results[0].id,
          orderKeys: Object.keys(axies.results[0].order),
          order: axies.results[0].order
        });
      }

      /* ------------------------------------------------------------------
       * Robust (but not overly-strict) filtering: ensure axie is actually
       * purchasable, while avoiding false negatives that remove everything.
       * ---------------------------------------------------------------- */

      // Track filtering reasons for better visibility
      const filterReasons: Record<string, number> = {
        excluded: 0,
        noOrder: 0,
        noPrice: 0,
        zeroPrice: 0,
        invalidStatus: 0,
        noSignature: 0,
        priceTooHigh: 0
      };

      const validAxies = axies.results.filter(axie => {
        // Skip if the Axie is known to be problematic / already sold
        if (this.excludedAxieIds.has(axie.id.toString())) {
          filterReasons.excluded++;
          return false;
        }

        const order = axie.order;
        if (!order) {
          filterReasons.noOrder++;
          return false;
        }

        // price must exist and be > 0
        if (!order.currentPrice) {
          filterReasons.noPrice++;
          return false;
        }
        if (BigInt(order.currentPrice) === BigInt(0)) {
          filterReasons.zeroPrice++;
          return false;
        }

        // RELAXED STATUS CHECK:
        // Only skip clearly invalid statuses like sold / cancelled / expired
        if (order.status && ['sold', 'cancelled', 'expired'].includes(order.status.toLowerCase())) {
          filterReasons.invalidStatus++;
          return false;
        }

        // RELAXED SIGNATURE CHECK:
        // Accept undefined but reject explicitly null / empty string
        if (order.signature === null || order.signature === '') {
          filterReasons.noSignature++;
          return false;
        }

        // respect maxPrice if supplied
        if (maxPrice !== undefined) {
          const priceEth = parseFloat(order.currentPrice) / 1e18;
          if (priceEth > maxPrice) {
            filterReasons.priceTooHigh++;
            return false;
          }
        }

        return true;
      });

      // Log filtering outcome
      this.logger.error('Filtering summary', {
        totalReceived: axies.results.length,
        totalFiltered: axies.results.length - validAxies.length,
        remaining: validAxies.length,
        reasons: filterReasons
      });

      // If filtering removed everything, give a clearer error.  This is the
      // situation users face when the "first 10 axies" are ghost orders.
      if (validAxies.length === 0) {
        throw new Error(
          'All returned Axies were filtered out (likely already sold). ' +
          'Try again in a few seconds or increase max-price / change filters.'
        );
      }

      // Limit to requested quantity
      return validAxies.slice(0, quantity);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to find Axies to purchase', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        options 
      });
      throw new Error(`Failed to find Axies to purchase: ${errorMessage}`);
    }
  }

  /**
   * Add Axie IDs to the exclusion list at runtime.
   * @param axieIds Array of Axie IDs to exclude
   */
  public addExcludedAxies(axieIds: string[]): void {
    axieIds.forEach(id => this.excludedAxieIds.add(id));
    this.logger.info('Added Axies to exclusion list', {
      added: axieIds.length,
      total: this.excludedAxieIds.size
    });
  }

  /**
   * Calculate total cost of purchasing Axies
   * @param axies Array of Axies to purchase
   * @returns Total cost in WETH (purchases are priced in WETH)
   */
  private calculateTotalCost(axies: Axie[]): number {
    return axies.reduce((total, axie) => {
      const price = axie.order?.currentPrice 
        ? parseFloat(axie.order.currentPrice) / 1e18 
        : 0;
      return total + price;
    }, 0);
  }

  /**
   * Estimate gas cost for the sweep
   * @param numAxies Number of Axies to purchase
   * @returns Estimated gas cost in RON
   */
  private async estimateGasCost(numAxies: number): Promise<number> {
    try {
      // Get current gas price
      const gasPrice = await this.walletService.estimateGasPrice();
      
      // Estimate gas limit based on number of Axies
      // Base gas for transaction + additional gas per Axie
      const baseGas = BigInt(100000);
      const gasPerAxie = BigInt(80000);
      const estimatedGasLimit = baseGas + gasPerAxie * BigInt(numAxies);
      
      // Calculate gas cost
      const gasCostWei = gasPrice * estimatedGasLimit;
      
      // Convert to RON
      const gasCostRon = parseFloat(ethers.formatEther(gasCostWei));
      
      return gasCostRon;
    } catch (error) {
      this.logger.error('Failed to estimate gas cost', { error, numAxies });
      return 0.01 * numAxies; // Fallback estimate
    }
  }

  /**
   * Execute the sweep
   * @param db Database connection
   * @param options Sweep options
   * @returns Sweep result
   */
  public async executeSweep(db: Knex, options: SweepOptions): Promise<SweepResult> {
    try {
      this.validateSweepOptions(options);
      
      // Get wallet instance
      const wallet = await this.walletService.getWalletInstance(db, options.walletId, options.userId);
      
      // Find Axies to purchase
      const axiesToPurchase = await this.findAxiesToPurchase(options);
      
      if (axiesToPurchase.length === 0) {
        throw new Error('No Axies found matching the criteria');
      }
      
      // Calculate total cost
      const totalCost = this.calculateTotalCost(axiesToPurchase);
      
      // Check if wallet has enough WETH balance
      const balances = await this.tokenService.getTokenBalances(wallet.address);
      const wethBalance = parseFloat(balances.weth);
      
      if (wethBalance < totalCost) {
        throw new Error(`Insufficient WETH balance: ${wethBalance} WETH available, ${totalCost} WETH required`);
      }
      
      // Check daily limit
      await this.checkDailyLimit(db, options.userId, totalCost);
      
      // Create and execute transaction
      const txResult = await this.createAndExecuteTransaction(wallet, axiesToPurchase);
      
      /* ------------------------------------------------------------------
       * Persist only successful transactions.
       * Failed executions often return an empty txHash which violates the
       * NOT-NULL/UNIQUE constraint on the `transactions.tx_hash` column.
       * ----------------------------------------------------------------- */
      let transaction: PurchaseTransaction | undefined;
      if (txResult.success && txResult.txHash) {
        try {
          transaction = await this.saveSweepTransaction(db, {
            txHash: txResult.txHash,
            userId: options.userId,
            walletId: options.walletId,
            collection: options.collection,
            axieIds: axiesToPurchase.map(axie => axie.id),
            totalAmount: totalCost,
            gasUsed: txResult.gasUsed,
            status: 'confirmed',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        } catch (persistError) {
          // Do not flip success – just log failure to persist
          this.logger.error('Failed to persist sweep transaction', {
            error: persistError instanceof Error ? persistError.message : String(persistError),
            txHash: txResult.txHash
          });
        }
      }
      
      // Return result
      return {
        success: txResult.success,
        transaction,
        purchasedAxies: txResult.success ? axiesToPurchase : [],
        failedAxies: txResult.success ? [] : axiesToPurchase,
        totalSpent: txResult.success ? totalCost : 0,
        gasUsed: txResult.gasUsed,
        txHash: txResult.txHash,
        error: txResult.error
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Sweep execution failed', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        options 
      });
      
      // Return failed result
      return {
        success: false,
        purchasedAxies: [],
        failedAxies: [],
        totalSpent: 0,
        error: errorMessage
      };
    }
  }

  /**
   * Check if the transaction would exceed daily limit
   * @param db Database connection
   * @param userId User ID
   * @param amount Transaction amount
   * @throws Error if daily limit would be exceeded
   */
  private async checkDailyLimit(db: Knex, userId: number, amount: number): Promise<void> {
    try {
      // Get user settings
      const settings = await db('user_settings')
        .where({ user_id: userId })
        .first();
      
      // Use default limit if no settings found
      const dailyLimit = settings?.daily_limit ?? config.security.maxDailyTransactionAmount;
      
      // Get today's transactions
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      /*
       * Determine which column exists so we don't hit “no such column”
       * on SQLite.  Prefer the new `amount` column; fall back to the
       * legacy `total_amount` column when `amount` is absent.
       */
      const hasAmount = await db.schema.hasColumn('transactions', 'amount');
      const sumColumn = hasAmount ? 'amount' : 'total_amount';

      const todayTransactions = await db('transactions')
        .where({ user_id: userId, status: 'confirmed' })
        .where('created_at', '>=', today)
        .sum<{ total: number }>(`${sumColumn} as total`)
        .first();
      
      const todayTotal = parseFloat(todayTransactions?.total ?? '0');
      
      // Check if this transaction would exceed the limit
      if (todayTotal + amount > dailyLimit) {
        throw new Error(`Transaction would exceed daily limit of ${dailyLimit} WETH (${todayTotal} WETH already spent today)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to check daily limit', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        userId, 
        amount 
      });
      throw error;
    }
  }

  /**
   * Create and execute transaction to purchase Axies
   * @param wallet Wallet instance
   * @param axies Array of Axies to purchase
   * @returns Transaction result
   */
  private async createAndExecuteTransaction(
    wallet: ethers.Wallet,
    axies: Axie[]
  ): Promise<{ success: boolean; txHash: string; gasUsed?: number; error?: string }> {
    try {
      // Initialize Market Gateway Contract
      // Constructor now only requires the signer wallet (provider is already attached)
      const gatewayContract = new MarketGatewayContract(wallet);
      
      // Gateway contract is the spender that actually pulls WETH
      // ------------------------------------------------------------------
      // Gateway contract addresses
      //  • gatewayAddress      – current proxy (entry point for calls)
      //  • deprecatedGateway   – legacy contract that actually pulls WETH
      //    The marketplace architecture still relies on this contract
      //    to execute `transferFrom` on WETH, so **allowance must be
      //    granted to this address**, not the current proxy.
      // ------------------------------------------------------------------
      const gatewayAddress      = '0x21a0a1c081dc2f3e48dc391786f53035f85ce0bc';
      const deprecatedGateway   = '0x3B3aDf1422f84254B7fbb0e7cA62Bd0865133fe3';

      /* ------------------------------------------------------------------
       * 1.  Split into batches of max 20 to avoid gas-limit issues
       * ----------------------------------------------------------------- */
      // Track last transaction hash so we can still surface it when the
      // receipt object in ethers v6 no longer includes .transactionHash.
      let lastTxHash: string | undefined;
      const MAX_BATCH = 20;
      const batches: Axie[][] = [];
      for (let i = 0; i < axies.length; i += MAX_BATCH) {
        batches.push(axies.slice(i, i + MAX_BATCH));
      }

      /* ------------------------------------------------------------------
       * Diagnostics: log batch creation so we can quickly see whether we
       * actually have Axies to process and how they are split up.
       * ---------------------------------------------------------------- */
      this.logger.info('Created batches for sweep', {
        axiesCount: axies.length,
        batchCount: batches.length,
        batchSizes: batches.map(b => b.length)
      });

      if (batches.length === 0) {
        throw new Error('No Axies to purchase - batches array is empty');
      }

      /**
       * Local helper – compute the signed settle-price exactly the same way the
       * marketplace backend signs it.  We define it once so it can be reused
       * both for allowance calculation (step 3) and when building the actual
       * SettleOrderParams later.
       */
      const computeSettlePrice = (o: any): string => {
        try {
          const startedAt = BigInt(String(o.startedAt ?? 0));
          const endedAt = BigInt(String(o.endedAt ?? 0));
          const base = BigInt(String(o.basePrice ?? o.currentPrice));
          const ended = BigInt(String(o.endedPrice ?? o.currentPrice ?? 0));
          if (endedAt === BigInt(0) || endedAt === startedAt) {
            return base.toString();
          }
          const nowSec = BigInt(Math.floor(Date.now() / 1000));
          const t = nowSec < endedAt ? nowSec : endedAt;
          const elapsed = t > startedAt ? (t - startedAt) : BigInt(0);
          const duration = endedAt - startedAt;
          const delta = ended - base;
          const price = base + (delta * elapsed) / duration;
          return price < BigInt(0) ? '0' : price.toString();
        } catch {
          return String(o.basePrice ?? o.currentPrice);
        }
      };

      let lastReceipt: ethers.TransactionReceipt | undefined;

      for (const batch of batches) {
        /* --------------------------------------------------------------
         * 2. Off-chain order diagnostics (signatures & nonce)
         *    Axie marketplace uses an off-chain order book with
         *    cryptographic signatures, so we no longer verify prices
         *    on-chain.  Instead, log essential order information for
         *    transparency and troubleshooting.
         * ------------------------------------------------------------ */
        batch.forEach(a => {
          this.logger.debug('Off-chain order info', {
            axieId: a.id,
            signaturePresent: !!a.order?.signature,
            nonce: a.order?.nonce
          });
        });

        // Remove any Axies without a valid signature
        const signedBatch = batch.filter(a => {
          const hasSig = !!a.order?.signature;
          if (!hasSig) {
            this.logger.warn('Skipping axie without signature', { axieId: a.id });
          }
          return hasSig;
        });

        // If for some reason the batch is empty, skip
        if (signedBatch.length === 0) continue;

        /* --------------------------------------------------------------
         * 3. Ensure WETH allowance is sufficient
         * ------------------------------------------------------------ */
        // Use the *signed* settle price and include marketplace fee (bps)
        // plus a small 1-gwei head-room to guarantee the allowance covers
        // exact transferFrom() amount.
        const batchTotalWei = signedBatch.reduce((sum, axie) => {
          const price = BigInt(computeSettlePrice(axie.order!));
          const feeBp = BigInt(
            (axie.order as any).marketFeePercentage ?? 425
          ); // default 4.25 %
          // Marketplace fee = ceil(price * feeBp / 10_000)
          const fee = (price * feeBp + 9_999n) / 10_000n;
          return sum + price + fee;
        }, 0n) + 1_000_000_000n; // add 1 gwei safety buffer
        const connectedToken = this.tokenService.connect(wallet);
        // IMPORTANT: approve WETH allowance to the *deprecated* gateway,
        // because this is the contract that performs transferFrom().
        const allowance = await connectedToken.checkAllowance(deprecatedGateway);
        // Log current allowance for easier diagnostics
        this.logger.info('Current WETH allowance', {
          spender: deprecatedGateway,
          allowance: ethers.formatEther(allowance.allowance)
        });
        // Ensure both sides are BigInt to avoid "Cannot mix BigInt and other types" errors
        if (BigInt(allowance.allowance) < batchTotalWei) {
          this.logger.info('Approving WETH to gateway', {
            spender: deprecatedGateway,
            amount: ethers.formatEther(batchTotalWei)
          });
          const approveRes = await connectedToken.approveWeth(
            ethers.formatEther(batchTotalWei),
            deprecatedGateway
          );
          if (!approveRes.success) {
            throw new Error(`WETH approve failed: ${approveRes.error}`);
          }
          // Re-check allowance after approval
          const postAllowance = await connectedToken.checkAllowance(deprecatedGateway);
          this.logger.info('Post-approval WETH allowance', {
            spender: deprecatedGateway,
            allowance: ethers.formatEther(postAllowance.allowance)
          });
        }

        /* --------------------------------------------------------------
         * 4. Prepare orders for the gateway contract
         * ------------------------------------------------------------ */
        const settleOrders: SettleOrderParams[] = [];
        for (const axie of signedBatch) {
          // Skip if critical fields for signature reconstruction are missing
          const o = axie.order!;
          const missing: string[] = [];
          if (!o.signature) missing.push('signature');
          if (o.expectedState === undefined) missing.push('expectedState');
          if (o.nonce === undefined) missing.push('nonce');
          if (!o.expiredAt) missing.push('expiredAt');
          // We need either (startedAt present) or (duration present) to derive startedAt
          const hasStartedAt = (o as any).startedAt !== undefined;
          const hasDuration = (o as any).duration !== undefined;
          if (!hasStartedAt && !hasDuration) missing.push('startedAt|duration');
          // marketFeePercentage frequently absent from GraphQL; we will default to 425 (4.25%)
          if (missing.length > 0) {
            this.logger.warn('Skipping axie due to missing signed fields', { axieId: axie.id, missing });
            continue;
          }
          // Convert Axie to proper order format (async – determines kind from on-chain owner)
          const order = await this.prepareOrder(axie);

          /* ----------------------------------------------------------
           * Extra diagnostics – log *exactly* what we are about to send
           * for each Axie so we can compare with the on-chain revert
           * reason / calldata shown in the explorer when debugging
           * failures such as "invalid payment token standard".
           * -------------------------------------------------------- */
          this.logger.info('Preparing settle order', {
            axieId: axie.id,
            expectedState: axie.order!.expectedState,
            nonce: axie.order!.nonce,
            signaturePresent: !!axie.order!.signature,
            signatureLength: axie.order!.signature?.length,
            settlePrice: axie.order!.currentPrice,
            maker: axie.order!.maker || (axie as any).order?.seller,
            paymentToken: order.paymentToken,
            kind: order.kind === OrderKind.Sell ? 'Sell' : 'Offer'
          });

          /* ----------------------------------------------------------
           * Hash sanity check
           * -------------------------------------------------------- */
          try {
            const providedHash = (axie.order as any).hash as string | undefined;
            if (providedHash) {
              // Use raw bytes if present; otherwise encode using the same method as the gateway
              const raw = (axie.order as any).orderData as string | undefined;
              const encoded = raw && raw !== ''
                ? raw
                : await (async () => {
                    // Reuse gateway encoder to ensure identical encoding
                    try {
                      return (gatewayContract as any).encodeOrder(order);
                    } catch {
                      // Fallback: no hash check
                      return undefined;
                    }
                  })();
              if (encoded) {
                const computed = ethers.keccak256(encoded as any);
                const normProvided = providedHash.startsWith('0x') ? providedHash.toLowerCase() : ('0x' + providedHash.toLowerCase());
                if (computed.toLowerCase() !== normProvided) {
                  this.logger.warn('Order hash mismatch – proceeding anyway (no raw bytes)', {
                    axieId: axie.id,
                    providedHash: normProvided,
                    computedHash: computed,
                    hasRawOrderData: !!raw
                  });
                }
              }
            }
          } catch (e) {
            this.logger.warn('Failed to perform order hash check, proceeding anyway', { axieId: axie.id, error: (e as Error).message });
          }

          // Compute settle price according to auction curve to satisfy on-chain check
          const signedPrice = computeSettlePrice(axie.order);
          settleOrders.push({
            // Always convert to string; use 0 when undefined/null
            expectedState: String(axie.order!.expectedState ?? 0),
            // Ensure settlePrice is a string to avoid BigInt mixing issues
            settlePrice: signedPrice,
            referralAddr: '0x0000000000000000000000000000000000000000',
            signature: axie.order!.signature || '0x',
            order,
            // Prefer passing raw signed bytes if present to avoid signature mismatch
            orderDataRaw: (axie.order as any).orderData
          });
        }

        /* --------------------------------------------------------------
         * 5. Execute batch purchase through gateway
         *    Guard against empty params which causes
         *    "MarketGatewayMultiSend: invalid array length".
         * ------------------------------------------------------------ */
        if (settleOrders.length === 0) {
          this.logger.warn('Skipping batch: no valid signed orders after filtering', {
            originalBatchSize: batch.length
          });
          continue;
        }

        const tx = await gatewayContract.settleOrders({ orders: settleOrders });
        // Store hash from the TransactionResponse – available immediately.
        lastTxHash = tx.hash;
        
        this.logger.info('Batch purchase transaction sent', { 
          hash: tx.hash, 
          count: batch.length,
          totalPrice: ethers.formatEther(batchTotalWei)
        });
        
        // Wait for transaction to be mined
        lastReceipt = await tx.wait();
        
        if (!lastReceipt || lastReceipt.status !== 1) {
          throw new Error('Batch transaction reverted');
        }
      }

      if (!lastReceipt) {
        this.logger.error('No transactions were executed', {
          batchCount: batches.length,
          axiesCount: axies.length
        });
        throw new Error('Nothing purchased - no transactions were executed');
      }

      /* --------------------------------------------------------------
       * Convert gas cost safely:
       *  - lastReceipt.gasUsed            -> BigInt
       *  - lastReceipt.effectiveGasPrice  -> BigInt
       * Multiply as BigInt first, then format as ether (string) and
       * finally parseFloat for numeric storage.
       * ------------------------------------------------------------ */
      // Ensure we always multiply two BigInts.  In some provider
      // implementations `effectiveGasPrice` may be undefined (ethers v5)
      // so we fall back to `gasPrice` which is always present.
      // We also cast both operands to BigInt explicitly to avoid the
      // "Cannot mix BigInt and other types" runtime error.
      const gasUsedBig   = BigInt(lastReceipt.gasUsed.toString());
      const gasPriceBig  = BigInt(
        ((lastReceipt as any).effectiveGasPrice ?? lastReceipt.gasPrice).toString()
      );
      const gasCostWei   = gasUsedBig * gasPriceBig;
      const gasUsed = parseFloat(ethers.formatEther(gasCostWei));

      return {
        success: true,
        txHash:
          (lastReceipt as any).transactionHash ||
          (lastReceipt as any).hash ||
          lastTxHash ||
          '',
        gasUsed
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Sweep transaction failed', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Extract transaction hash if available
      let txHash = '';
      // Ethers v6 may expose the hash on different keys depending on where
      // the failure originates (e.g. `.hash` on TransactionResponse or
      // `.transactionHash` on a reverted receipt).  Capture both.
      if (error && typeof error === 'object') {
        txHash =
          (error as any).transactionHash ||
          (error as any).hash ||
          '';
      }
      
      return {
        success: false,
        txHash,
        error: errorMessage
      };
    }
  }

  /**
   * Prepare order object for marketplace gateway contract
   * @param axie Axie to purchase
   * @returns Erc721Order formatted for gateway contract
   */
  private async prepareOrder(axie: Axie): Promise<Erc721Order> {
    if (!axie.order) {
      throw new Error(`Axie ${axie.id} has no order information`);
    }
    
    // Extract order data
    const order = axie.order;
    // Log critical off-chain order data for troubleshooting
    this.logger.debug('Preparing order for Axie', {
      axieId: axie.id,
      signaturePresent: !!order.signature,
      noncePresent: order.nonce !== undefined,
      nonce: order.nonce
    });
    
    // Format asset item - ensure ID is a string to avoid BigInt mixing
    const assetItem: OrderAssetItem = {
      erc: 1, // ERC721 standard (marketplace expects 1, fits uint8)
      addr: this.marketplaceService.getAxieContractAddress(),
      id: axie.id.toString(), // Convert ID to string to avoid BigInt mixing
      /* ----------------------------------------------------------------
       * Quantity must match what was signed off-chain.
       * The GraphQL API reports `"quantity": "0"` for ERC-721 orders,
       * so we honour that.  If the field is missing we fall back to "0".
       * -------------------------------------------------------------- */
      quantity:
        (axie.order as any)?.assets?.[0]?.quantity !== undefined
          ? String((axie.order as any).assets[0].quantity)
          : "0"
    };

    // Get current timestamp for defaults
    const now = Math.floor(Date.now() / 1000);

    // Build order object (all numeric values converted to string)
    // Normalize addresses from ronin: to 0x
    const normalizeAddress = (addr?: string): string => {
      if (!addr) return '0x0000000000000000000000000000000000000000';
      return addr.startsWith('ronin:') ? ('0x' + addr.slice(6)) : addr;
    };

    const normalizedMaker = normalizeAddress(order.maker || (order as any).seller);
    const normalizedPaymentToken = normalizeAddress(order.paymentToken) || config.blockchain.wethTokenAddress;

    /* ------------------------------------------------------------------
     * Determine order kind
     * ------------------------------------------------------------------
     *  • Marketplace listings are **almost always** Sell orders, meaning
     *    the current owner is selling their Axie.
     *  • Offer orders (buyer bids) are rare and are typically marked
     *    explicitly in the API (`kind = "Offer"` or numeric value 2).
     *  • To avoid mis-classification (which breaks recipient logic and
     *    signature validation), we default to Sell unless the API
     *    explicitly tells us otherwise.
     * ---------------------------------------------------------------- */
    let isSell = true; // sensible default for marketplace listings
    if ((order as any).kind !== undefined) {
      const kindStr = String((order as any).kind).toLowerCase();
      // Accept both textual and numeric representations
      if (kindStr === 'offer' || kindStr === '2') {
        isSell = false;
      } else if (kindStr === 'sell' || kindStr === '0') {
        isSell = true;
      }
    }

    const preparedOrder: Erc721Order = {
      maker: normalizedMaker,
      kind: OrderKind.Sell,
      assets: [assetItem],
      // Convert all timestamps to strings
      expiredAt: (order.expiredAt ?? (now + 86400)).toString(),
      // Use the payment token specified by the order; if missing, fall back to WETH
      paymentToken: normalizedPaymentToken,
      // Use provided startedAt exactly when present; compute only if truly absent
      startedAt: (
        (order as any).startedAt !== undefined
          ? String((order as any).startedAt)
          : (() => {
              const duration = (order as any).duration;
              const expired = order.expiredAt;
              if (expired && typeof duration === 'number' && duration > 0) {
                return (Number(expired) - Number(duration)).toString();
              }
              return (now - 3600).toString();
            })()
      ),
      // Ensure price values are strings
      basePrice: (order.basePrice || order.currentPrice).toString(),
      // Use provided endedAt exactly; allow 0 when signed that way
      endedAt: (((order as any).endedAt !== undefined ? (order as any).endedAt : order.expiredAt) ?? (now + 86400)).toString(),
      endedPrice: (order.endedPrice || order.currentPrice).toString(),
      // Convert other numeric values to strings
      expectedState: (order.expectedState && String(order.expectedState).length > 0 ? order.expectedState : 0).toString(),
      // Use off-chain nonce provided by marketplace API (default to 0 if truly absent)
      nonce: (order.nonce ?? 0).toString(),
      marketFeePercentage: ((order as any).marketFeePercentage ?? 425).toString() // 4.25%

    };

    /* ------------------------------------------------------------------
     * Comprehensive diagnostics – log the original order we received
     * from the GraphQL API **and** the encoded order that will be sent
     * to the Market Gateway.  This makes it much easier to diagnose
     * on-chain validation errors such as "invalid payment token
     * standard", bad signatures, incorrect nonce, etc.
     * ---------------------------------------------------------------- */
    this.logger.warn('PREPARED ORDER DETAILS', {
      axieId: axie.id,
      originalOrder: {
        maker: order.maker,
        seller: (order as any).seller,
        currentPrice: order.currentPrice,
        basePrice: order.basePrice,
        expectedState: order.expectedState,
        nonce: order.nonce,
        signature: order.signature
          ? `${order.signature.substring(0, 10)}...`
          : 'MISSING',
        expiredAt: order.expiredAt,
        paymentToken: order.paymentToken
      },
      preparedOrder: {
        maker: preparedOrder.maker,
        paymentToken: preparedOrder.paymentToken,
        basePrice: preparedOrder.basePrice,
        expectedState: preparedOrder.expectedState,
        nonce: preparedOrder.nonce,
        kind: preparedOrder.kind === OrderKind.Sell ? 'Sell' : 'Offer'
      }
    });

    return preparedOrder;
  }

  // Minimal ERC-721 interface to query current owner
  private async getAxieOwner(axieId: string): Promise<string> {
    try {
      const erc721Abi = [
        'function ownerOf(uint256 tokenId) view returns (address)'
      ];
      const axieContract = new ethers.Contract(
        this.marketplaceService.getAxieContractAddress(),
        erc721Abi,
        this.provider
      );
      const owner: string = await axieContract.ownerOf(BigInt(axieId));
      return owner;
    } catch (error) {
      this.logger.warn('Failed to fetch on-chain owner; defaulting to Sell', { axieId, error });
      // Fallback to assume Sell to maintain previous behavior
      return (axieId && '0x' + '0'.repeat(40));
    }
  }

  /**
   * Save sweep transaction to database
   * @param db Database connection
   * @param transaction Transaction data
   * @returns Saved transaction
   */
  private async saveSweepTransaction(db: Knex, transaction: PurchaseTransaction): Promise<PurchaseTransaction> {
    try {
      /* ------------------------------------------------------------------
       * 1. Insert into master `transactions` table (tx_type = 'sweep')
       * ---------------------------------------------------------------- */
      const [txId] = await db('transactions')
        .insert({
          user_id: transaction.userId,
          wallet_id: transaction.walletId,
          tx_hash: transaction.txHash,
          tx_type: 'sweep',
          status: transaction.status,
          amount: transaction.totalAmount,
          gas_used: transaction.gasUsed,
          metadata: JSON.stringify({ collection: transaction.collection }),
          created_at: transaction.createdAt,
          updated_at: transaction.updatedAt
        })
        .returning('id');

      /* ------------------------------------------------------------------
       * 2. Insert into `sweep_history` (detailed per-sweep info)
       * ---------------------------------------------------------------- */
      await db('sweep_history').insert({
        user_id: transaction.userId,
        wallet_id: transaction.walletId,
        transaction_id: txId,
        collection: transaction.collection,
        quantity: transaction.axieIds.length,
        max_price: null,
        total_amount: transaction.totalAmount,
        axie_ids: JSON.stringify(transaction.axieIds),
        status: 'completed',
        created_at: transaction.createdAt,
        updated_at: transaction.updatedAt,
        completed_at: transaction.createdAt
      });

      /* ------------------------------------------------------------------
       * 3. Enforce keeping only the latest 30 sweep tx for this user
       * ---------------------------------------------------------------- */
      await this.enforceHistoryRetention(db, transaction.userId, 30);

      this.logger.info('Sweep transaction saved', { txId, txHash: transaction.txHash });
      return transaction;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to save sweep transaction', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        txHash: transaction.txHash 
      });
      throw error;
    }
  }

  /**
   * Keep only the latest `limit` sweep transactions for a user.
   */
  private async enforceHistoryRetention(db: Knex, userId: number, limit: number = 30): Promise<void> {
    try {
      const oldIds = await db('transactions')
        .where({ user_id: userId, tx_type: 'sweep' })
        .orderBy('created_at', 'desc')
        .offset(limit)
        .pluck('id');

      if (oldIds.length === 0) return;

      await db('sweep_history')
        .whereIn('transaction_id', oldIds)
        .andWhere({ user_id: userId })
        .del();

      await db('transactions')
        .whereIn('id', oldIds)
        .andWhere({ user_id: userId })
        .del();

      this.logger.info('Old sweep history pruned', { userId, removed: oldIds.length });
    } catch (err) {
      this.logger.warn('Failed to prune sweep history', { err, userId });
    }
  }

  /**
   * Update transaction status in database
   * @param db Database connection
   * @param txHash Transaction hash
   * @param status New status
   * @param gasUsed Gas used (optional)
   * @param error Error message (optional)
   * @returns Updated transaction
   */
  public async updateTransactionStatus(
    db: Knex,
    txHash: string,
    status: 'pending' | 'confirmed' | 'failed',
    gasUsed?: number,
    error?: string
  ): Promise<void> {
    try {
      // Update transactions row
      const [row] = await db('transactions')
        .where({ tx_hash: txHash })
        .select('id', 'metadata');

      if (!row) {
        this.logger.warn('updateTransactionStatus: tx not found', { txHash, status });
        return;
      }

      // Merge error into metadata if provided
      let metadata: any = {};
      try {
        metadata = row.metadata ? JSON.parse(row.metadata) : {};
      } catch {
        /* ignore corrupt metadata */
      }
      if (error) metadata.error = error;

      await db('transactions')
        .where({ id: row.id })
        .update({
          status,
          gas_used: gasUsed,
          metadata: JSON.stringify(metadata),
          updated_at: new Date()
        });

      // Reflect status in sweep_history
      const histStatus =
        status === 'confirmed'
          ? 'completed'
          : status === 'failed'
          ? 'failed'
          : 'pending';
      const histUpdate: any = {
        status: histStatus,
        updated_at: new Date()
      };
      if (status === 'confirmed' || status === 'failed') {
        histUpdate.completed_at = new Date();
      }
      await db('sweep_history')
        .where({ transaction_id: row.id })
        .update(histUpdate);

      this.logger.info('Transaction status updated', { txHash, status });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.error('Failed to update transaction status', { error: errorMessage, txHash, status });
      throw e;
    }
  }

  /**
   * Monitor transaction status
   * @param db Database connection
   * @param txHash Transaction hash
   * @returns Final transaction status
   */
  public async monitorTransaction(db: Knex, txHash: string): Promise<'confirmed' | 'failed'> {
    try {
      // Maximum attempts
      const maxAttempts = 20;
      // Delay between attempts (in ms)
      const delay = 5000;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          // Get transaction receipt
          const receipt = await this.provider.getTransactionReceipt(txHash);
          
          if (receipt) {
            // Transaction mined
            const success = receipt.status === 1;
            const gasUsedBig = BigInt(receipt.gasUsed.toString());
            const gasPriceBig = BigInt(((receipt as any).effectiveGasPrice ?? receipt.gasPrice).toString());
            const gasCostWei = gasUsedBig * gasPriceBig;
            const gasUsed = parseFloat(ethers.formatEther(gasCostWei));
            
            // Update transaction status
            await this.updateTransactionStatus(
              db,
              txHash,
              success ? 'confirmed' : 'failed',
              gasUsed,
              success ? undefined : 'Transaction execution failed'
            );
            
            return success ? 'confirmed' : 'failed';
          }
          
          // Wait before next attempt
          await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.warn('Error checking transaction receipt', { 
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            txHash, 
            attempt 
          });
          // Wait before next attempt
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // Max attempts reached, transaction still pending
      this.logger.warn('Transaction monitoring timeout', { txHash });
      return 'failed';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Transaction monitoring failed', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        txHash 
      });
      
      // Update transaction status to failed
      await this.updateTransactionStatus(
        db,
        txHash,
        'failed',
        undefined,
        `Monitoring failed: ${errorMessage}`
      );
      
      return 'failed';
    }
  }

  /**
   * Get transaction history for a user
   * @param db Database connection
   * @param userId User ID
   * @param limit Maximum number of transactions to return
   * @param offset Offset for pagination
   * @returns Array of transactions
   */
  public async getTransactionHistory(
    db: Knex,
    userId: number,
    limit: number = 10,
    offset: number = 0
  ): Promise<PurchaseTransaction[]> {
    try {
      const rows = await db('transactions as t')
        .innerJoin('sweep_history as sh', 'sh.transaction_id', 't.id')
        .where({ 't.user_id': userId, 't.tx_type': 'sweep' })
        .orderBy('t.created_at', 'desc')
        .limit(30)
        .select(
          't.tx_hash as txHash',
          't.user_id as userId',
          't.wallet_id as walletId',
          'sh.collection as collection',
          'sh.axie_ids as axieIds',
          'sh.total_amount as totalAmount',
          't.gas_used as gasUsed',
          't.status as status',
          't.created_at as createdAt',
          't.updated_at as updatedAt'
        );

      return rows.map((r: any) => ({
        ...r,
        axieIds: typeof r.axieIds === 'string' ? JSON.parse(r.axieIds) : r.axieIds
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to get transaction history', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        userId 
      });
      throw error;
    }
  }

  /**
   * Get transaction details
   * @param db Database connection
   * @param txHash Transaction hash
   * @param userId User ID (for security check)
   * @returns Transaction details with purchased Axies
   */
  public async getTransactionDetails(
    db: Knex,
    txHash: string,
    userId: number
  ): Promise<{ transaction: PurchaseTransaction; axies: Axie[] }> {
    try {
      const transaction: any = await db('transactions as t')
        .innerJoin('sweep_history as sh', 'sh.transaction_id', 't.id')
        .where({ 't.tx_hash': txHash, 't.user_id': userId, 't.tx_type': 'sweep' })
        .first(
          't.tx_hash as txHash',
          't.user_id as userId',
          't.wallet_id as walletId',
          'sh.collection as collection',
          'sh.axie_ids as axieIds',
          'sh.total_amount as totalAmount',
          't.gas_used as gasUsed',
          't.status as status',
          't.created_at as createdAt',
          't.updated_at as updatedAt'
        );

      if (!transaction) {
        throw new Error('Transaction not found or does not belong to this user');
      }

      if (typeof transaction.axieIds === 'string') {
        transaction.axieIds = JSON.parse(transaction.axieIds);
      }

      const axies = await this.marketplaceService.getAxiesByIds(transaction.axieIds);
      return { transaction, axies };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to get transaction details', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        txHash, 
        userId 
      });
      throw error;
    }
  }

  /**
   * Generate sweep report
   * @param db Database connection
   * @param txHash Transaction hash
   * @param userId User ID (for security check)
   * @returns Formatted report text
   */
  public async generateSweepReport(db: Knex, txHash: string, userId: number): Promise<string> {
    try {
      // Get transaction details
      const { transaction, axies } = await this.getTransactionDetails(db, txHash, userId);
      
      // Get wallet info
      const wallet = await db('wallets')
        .where({ id: transaction.walletId })
        .first('address', 'name');
      
      // Format report
      let report = `🧹 SWEEP REPORT 🧹

`;
      report += `Collection: ${transaction.collection}
`;
      report += `Status: ${this.formatStatus(transaction.status)}
`;
      report += `Date: ${transaction.createdAt.toLocaleString()}

`;
      
      report += `Wallet: ${wallet.name} (${this.formatAddress(wallet.address)})
`;
      report += `Total Spent: ${transaction.totalAmount.toFixed(4)} WETH
`;
      
      if (transaction.gasUsed) {
        report += `Gas Used: ${transaction.gasUsed.toFixed(4)} RON
`;
        report += `Total Cost: ${(transaction.totalAmount + transaction.gasUsed).toFixed(4)} (WETH + RON)
`;
      }
      
      report += `
Axies Purchased: ${axies.length}
`;
      
      if (axies.length > 0) {
        report += `Average Price: ${(transaction.totalAmount / axies.length).toFixed(4)} WETH

`;
        
        report += `Axie IDs:
`;
        axies.forEach((axie, index) => {
          const price = axie.order?.currentPrice 
            ? (parseFloat(axie.order.currentPrice) / 1e18).toFixed(4) 
            : 'N/A';
          report += `${index + 1}. #${axie.id} (${axie.class}) - ${price} WETH
`;
        });
      }
      
      if (transaction.error) {
        report += `
Error: ${transaction.error}
`;
      }
      
      report += `
Transaction: ${this.formatTxHash(transaction.txHash)}
`;
      report += `Explorer: https://explorer.roninchain.com/tx/${transaction.txHash}
`;
      
      return report;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to generate sweep report', { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        txHash, 
        userId 
      });
      throw error;
    }
  }

  /**
   * Format status for display
   * @param status Transaction status
   * @returns Formatted status
   */
  private formatStatus(status: string): string {
    switch (status) {
      case 'confirmed':
        return '✅ Confirmed';
      case 'pending':
        return '⏳ Pending';
      case 'failed':
        return '❌ Failed';
      default:
        return status;
    }
  }

  /**
   * Format address for display
   * @param address Wallet address
   * @returns Formatted address
   */
  private formatAddress(address: string): string {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  /**
   * Format transaction hash for display
   * @param txHash Transaction hash
   * @returns Formatted transaction hash
   */
  private formatTxHash(txHash: string): string {
    return `${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 6)}`;
  }
}

export default SweepService;
