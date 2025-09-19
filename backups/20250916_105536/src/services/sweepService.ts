import { ethers } from 'ethers';
import { Knex } from 'knex';
import config from '../config';
import Logger from '../utils/logger';
import MarketplaceService, { Axie, AxieCollection } from './marketplaceService';
import WalletService from './walletService';

// ABI for Axie Marketplace interaction
const MARKETPLACE_ABI = [
  // Read-only functions
  'function isOrderValid(bytes32 hash) view returns (bool)',
  'function getOrderStatus(bytes32 hash) view returns (uint8)',
  // Authenticated functions
  'function settleOrder(tuple(address maker, tuple(uint8 erc, address addr, uint256 id, uint256 quantity)[] assets, uint256 expiredAt, address paymentToken, uint256 startedAt, uint256 basePrice, uint256 endedAt, uint256 endedPrice, uint256 expectedState, uint256 nonce, uint256 marketFeePercentage, bytes signature) order, uint256 expectedPrice) payable',
  'function settleOrders(tuple(address maker, tuple(uint8 erc, address addr, uint256 id, uint256 quantity)[] assets, uint256 expiredAt, address paymentToken, uint256 startedAt, uint256 basePrice, uint256 endedAt, uint256 endedPrice, uint256 expectedState, uint256 nonce, uint256 marketFeePercentage, bytes signature)[] orders, uint256[] expectedPrices) payable',
  // Events
  'event OrderSettled(bytes32 indexed hash, address indexed maker, address indexed taker, tuple(uint8 erc, address addr, uint256 id, uint256 quantity) asset, uint256 price)'
];

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
  private provider: ethers.JsonRpcProvider;
  
  /**
   * Constructor
   */
  constructor() {
    this.logger = new Logger('sweep-service');
    this.marketplaceService = new MarketplaceService();
    this.walletService = new WalletService();
    this.provider = new ethers.JsonRpcProvider(config.blockchain.roninMainnetRpc);
    
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
      this.logger.error('Failed to generate sweep preview', { error, options });
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
      
      // Filter out Axies without valid orders
      const validAxies = axies.results.filter(axie => 
        axie.order && 
        axie.order.currentPrice && 
        (!maxPrice || parseFloat(axie.order.currentPrice) / 1e18 <= maxPrice)
      );
      
      // Limit to requested quantity
      return validAxies.slice(0, quantity);
    } catch (error) {
      this.logger.error('Failed to find Axies to purchase', { error, options });
      throw new Error(`Failed to find Axies to purchase: ${(error as Error).message}`);
    }
  }

  /**
   * Calculate total cost of purchasing Axies
   * @param axies Array of Axies to purchase
   * @returns Total cost in RON
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
      
      // Check if wallet has enough balance
      const balances = await this.walletService.getTokenBalances(wallet.address);
      const ronBalance = parseFloat(balances.ron);
      
      if (ronBalance < totalCost) {
        throw new Error(`Insufficient balance: ${ronBalance} RON available, ${totalCost} RON required`);
      }
      
      // Check daily limit
      await this.checkDailyLimit(db, options.userId, totalCost);
      
      // Create and execute transaction
      const txResult = await this.createAndExecuteTransaction(wallet, axiesToPurchase);
      
      // Save transaction to database
      const transaction = await this.saveSweepTransaction(db, {
        txHash: txResult.txHash,
        userId: options.userId,
        walletId: options.walletId,
        collection: options.collection,
        axieIds: axiesToPurchase.map(axie => axie.id),
        totalAmount: totalCost,
        gasUsed: txResult.gasUsed,
        status: txResult.success ? 'confirmed' : 'failed',
        error: txResult.error,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // Return result
      return {
        success: txResult.success,
        transaction,
        purchasedAxies: txResult.success ? axiesToPurchase : [],
        failedAxies: txResult.success ? [] : axiesToPurchase,
        totalSpent: txResult.success ? totalCost : 0,
        gasUsed: txResult.gasUsed,
        error: txResult.error
      };
    } catch (error) {
      this.logger.error('Sweep execution failed', { error, options });
      
      // Return failed result
      return {
        success: false,
        purchasedAxies: [],
        failedAxies: [],
        totalSpent: 0,
        error: (error as Error).message
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
      
      const todayTransactions = await db('transactions')
        .where({ user_id: userId, status: 'confirmed' })
        .where('created_at', '>=', today)
        .sum('total_amount as total')
        .first();
      
      const todayTotal = parseFloat(todayTransactions?.total ?? '0');
      
      // Check if this transaction would exceed the limit
      if (todayTotal + amount > dailyLimit) {
        throw new Error(`Transaction would exceed daily limit of ${dailyLimit} RON (${todayTotal} RON already spent today)`);
      }
    } catch (error) {
      this.logger.error('Failed to check daily limit', { error, userId, amount });
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
      // Create marketplace contract instance
      const marketplaceAddress = this.marketplaceService.getMarketplaceContractAddress();
      const marketplaceContract = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);
      
      // Prepare orders and prices arrays
      const orders = axies.map(axie => this.prepareOrder(axie));
      const prices = axies.map(axie => BigInt(axie.order?.currentPrice || '0'));
      
      // Calculate total value to send
      const totalValue = prices.reduce((sum, price) => sum + price, BigInt(0));
      
      // Estimate gas
      let gasLimit;
      try {
        gasLimit = await marketplaceContract.settleOrders.estimateGas(orders, prices, { value: totalValue });
        // Add 20% buffer for safety
        gasLimit = BigInt(Math.floor(Number(gasLimit) * 1.2));
      } catch (error) {
        this.logger.error('Failed to estimate gas', { error });
        // Use fallback gas limit
        gasLimit = BigInt(config.blockchain.defaultGasLimit) * BigInt(axies.length);
      }
      
      // Get gas price
      const gasPrice = await this.walletService.estimateGasPrice();
      
      // Execute transaction
      this.logger.info('Executing sweep transaction', { 
        numAxies: axies.length, 
        totalValue: ethers.formatEther(totalValue),
        gasLimit: gasLimit.toString(),
        gasPrice: ethers.formatUnits(gasPrice, 'gwei')
      });
      
      const tx = await marketplaceContract.settleOrders(orders, prices, {
        value: totalValue,
        gasLimit,
        gasPrice
      });
      
      this.logger.info('Sweep transaction sent', { txHash: tx.hash });
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction failed: No receipt returned');
      }
      
      const gasUsed = parseFloat(ethers.formatEther(receipt.gasUsed * receipt.gasPrice));
      
      this.logger.info('Sweep transaction confirmed', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed
      });
      
      return {
        success: true,
        txHash: receipt.hash,
        gasUsed
      };
    } catch (error) {
      this.logger.error('Sweep transaction failed', { error });
      
      // Extract transaction hash if available
      let txHash = '';
      if (error && typeof error === 'object' && 'transactionHash' in error) {
        txHash = (error as any).transactionHash;
      }
      
      return {
        success: false,
        txHash,
        error: (error as Error).message
      };
    }
  }

  /**
   * Prepare order object for marketplace contract
   * @param axie Axie to purchase
   * @returns Order object formatted for contract
   */
  private prepareOrder(axie: Axie): any {
    if (!axie.order) {
      throw new Error(`Axie ${axie.id} has no order information`);
    }
    
    // Extract order data
    const order = axie.order;
    
    // Format assets array
    const assets = [{
      erc: 1, // ERC721
      addr: this.marketplaceService.getAxieContractAddress(),
      id: axie.id,
      quantity: 1
    }];
    
    // Return formatted order
    return {
      maker: order.maker || order.seller,
      assets,
      expiredAt: order.expiredAt || Math.floor(Date.now() / 1000) + 86400, // Default to 24h from now
      paymentToken: '0x0000000000000000000000000000000000000000', // ETH/RON
      startedAt: order.startedAt || Math.floor(Date.now() / 1000) - 3600, // Default to 1h ago
      basePrice: order.basePrice || order.currentPrice,
      endedAt: order.endedAt || Math.floor(Date.now() / 1000) + 86400, // Default to 24h from now
      endedPrice: order.endedPrice || order.currentPrice,
      expectedState: order.expectedState || 0,
      nonce: order.nonce || 0,
      marketFeePercentage: order.marketFeePercentage || 425, // 4.25%
      signature: order.signature || '0x'
    };
  }

  /**
   * Save sweep transaction to database
   * @param db Database connection
   * @param transaction Transaction data
   * @returns Saved transaction
   */
  private async saveSweepTransaction(db: Knex, transaction: PurchaseTransaction): Promise<PurchaseTransaction> {
    try {
      // Insert transaction
      const [id] = await db('transactions').insert({
        user_id: transaction.userId,
        wallet_id: transaction.walletId,
        tx_hash: transaction.txHash,
        collection: transaction.collection,
        axie_ids: transaction.axieIds,
        total_amount: transaction.totalAmount,
        gas_used: transaction.gasUsed,
        status: transaction.status,
        created_at: transaction.createdAt,
        updated_at: transaction.updatedAt
      });
      
      this.logger.info('Sweep transaction saved to database', { id, txHash: transaction.txHash });
      
      return transaction;
    } catch (error) {
      this.logger.error('Failed to save sweep transaction', { error, txHash: transaction.txHash });
      throw error;
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
      await db('transactions')
        .where({ tx_hash: txHash })
        .update({
          status,
          gas_used: gasUsed,
          error: error,
          updated_at: new Date()
        });
      
      this.logger.info('Transaction status updated', { txHash, status });
    } catch (error) {
      this.logger.error('Failed to update transaction status', { error, txHash, status });
      throw error;
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
            const gasUsed = parseFloat(ethers.formatEther(receipt.gasUsed * receipt.gasPrice));
            
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
          this.logger.warn('Error checking transaction receipt', { error, txHash, attempt });
          // Wait before next attempt
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // Max attempts reached, transaction still pending
      this.logger.warn('Transaction monitoring timeout', { txHash });
      return 'failed';
    } catch (error) {
      this.logger.error('Transaction monitoring failed', { error, txHash });
      
      // Update transaction status to failed
      await this.updateTransactionStatus(
        db,
        txHash,
        'failed',
        undefined,
        `Monitoring failed: ${(error as Error).message}`
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
      const transactions = await db('transactions')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .select(
          'tx_hash as txHash',
          'user_id as userId',
          'wallet_id as walletId',
          'collection',
          'axie_ids as axieIds',
          'total_amount as totalAmount',
          'gas_used as gasUsed',
          'status',
          'error',
          'created_at as createdAt',
          'updated_at as updatedAt'
        );
      
      return transactions;
    } catch (error) {
      this.logger.error('Failed to get transaction history', { error, userId });
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
      // Get transaction
      const transaction = await db('transactions')
        .where({ tx_hash: txHash, user_id: userId })
        .first(
          'tx_hash as txHash',
          'user_id as userId',
          'wallet_id as walletId',
          'collection',
          'axie_ids as axieIds',
          'total_amount as totalAmount',
          'gas_used as gasUsed',
          'status',
          'error',
          'created_at as createdAt',
          'updated_at as updatedAt'
        );
      
      if (!transaction) {
        throw new Error('Transaction not found or does not belong to this user');
      }
      
      // Get Axie details
      const axies = await this.marketplaceService.getAxiesByIds(transaction.axieIds);
      
      return { transaction, axies };
    } catch (error) {
      this.logger.error('Failed to get transaction details', { error, txHash, userId });
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
      let report = `🧹 SWEEP REPORT 🧹\n\n`;
      report += `Collection: ${transaction.collection}\n`;
      report += `Status: ${this.formatStatus(transaction.status)}\n`;
      report += `Date: ${transaction.createdAt.toLocaleString()}\n\n`;
      
      report += `Wallet: ${wallet.name} (${this.formatAddress(wallet.address)})\n`;
      report += `Total Spent: ${transaction.totalAmount.toFixed(4)} RON\n`;
      
      if (transaction.gasUsed) {
        report += `Gas Used: ${transaction.gasUsed.toFixed(4)} RON\n`;
        report += `Total Cost: ${(transaction.totalAmount + transaction.gasUsed).toFixed(4)} RON\n`;
      }
      
      report += `\nAxies Purchased: ${axies.length}\n`;
      
      if (axies.length > 0) {
        report += `Average Price: ${(transaction.totalAmount / axies.length).toFixed(4)} RON\n\n`;
        
        report += `Axie IDs:\n`;
        axies.forEach((axie, index) => {
          const price = axie.order?.currentPrice 
            ? (parseFloat(axie.order.currentPrice) / 1e18).toFixed(4) 
            : 'N/A';
          report += `${index + 1}. #${axie.id} (${axie.class}) - ${price} RON\n`;
        });
      }
      
      if (transaction.error) {
        report += `\nError: ${transaction.error}\n`;
      }
      
      report += `\nTransaction: ${this.formatTxHash(transaction.txHash)}\n`;
      report += `Explorer: https://explorer.roninchain.com/tx/${transaction.txHash}\n`;
      
      return report;
    } catch (error) {
      this.logger.error('Failed to generate sweep report', { error, txHash, userId });
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
