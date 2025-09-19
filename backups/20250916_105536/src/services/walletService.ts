import { ethers } from 'ethers';
import CryptoJS from 'crypto-js';
import { Knex } from 'knex';
import config from '../config';
import Logger from '../utils/logger';

// ABI definitions for token contracts
const ERC20_ABI = [
  // Read-only functions
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  // Authenticated functions
  'function transfer(address to, uint amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

// Interface for wallet data
interface WalletData {
  id?: number;
  userId: number;
  address: string;
  encryptedPrivateKey: string;
  name?: string;
  isActive: boolean;
}

// Interface for token balances
interface TokenBalances {
  ron: string;
  axs: string;
  slp: string;
}

/**
 * Service for managing Ronin wallets
 */
class WalletService {
  private logger: Logger;
  private provider: ethers.JsonRpcProvider;
  
  // Contract addresses
  private readonly axsTokenAddress: string = '0x97a9107c1793bc407d6f527b77e7fff4d812bece';
  private readonly slpTokenAddress: string = '0xa8754b9fa15fc18bb59458815510e40a12cd2014';
  private readonly ronTokenAddress: string = config.blockchain.ronTokenAddress;

  /**
   * Constructor
   */
  constructor() {
    this.logger = new Logger('wallet-service');
    this.provider = new ethers.JsonRpcProvider(config.blockchain.roninMainnetRpc);
    
    this.logger.info('Wallet service initialized');
  }

  /**
   * Generate a new random wallet
   * @returns The new wallet instance
   */
  public generateWallet(): ethers.Wallet {
    try {
      const wallet = ethers.Wallet.createRandom();
      this.logger.info('New wallet generated');
      return wallet;
    } catch (error) {
      this.logger.error('Failed to generate wallet', { error });
      throw new Error('Failed to generate wallet');
    }
  }

  /**
   * Import wallet from private key
   * @param privateKey The private key
   * @returns The wallet instance
   */
  public importFromPrivateKey(privateKey: string): ethers.Wallet {
    try {
      // Ensure private key has 0x prefix
      const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
      const wallet = new ethers.Wallet(formattedKey);
      this.logger.info('Wallet imported from private key');
      return wallet;
    } catch (error) {
      this.logger.error('Failed to import wallet from private key', { error });
      throw new Error('Invalid private key format');
    }
  }

  /**
   * Import wallet from seed phrase (mnemonic)
   * @param seedPhrase The seed phrase (mnemonic)
   * @param path The derivation path (optional)
   * @returns The wallet instance
   */
  public importFromSeedPhrase(seedPhrase: string, path?: string): ethers.Wallet {
    try {
      // Default to first account if no path provided
      const derivationPath = path || "m/44'/60'/0'/0/0";
      const wallet = ethers.Wallet.fromPhrase(seedPhrase, undefined, derivationPath);
      this.logger.info('Wallet imported from seed phrase');
      return wallet;
    } catch (error) {
      this.logger.error('Failed to import wallet from seed phrase', { error });
      throw new Error('Invalid seed phrase format');
    }
  }

  /**
   * Encrypt a private key using AES encryption
   * @param privateKey The private key to encrypt
   * @returns The encrypted private key
   */
  public encryptPrivateKey(privateKey: string): string {
    try {
      const encryptionKey = config.security.encryptionKey;
      const encrypted = CryptoJS.AES.encrypt(privateKey, encryptionKey).toString();
      return encrypted;
    } catch (error) {
      this.logger.error('Failed to encrypt private key', { error });
      throw new Error('Failed to encrypt private key');
    }
  }

  /**
   * Decrypt an encrypted private key
   * @param encryptedPrivateKey The encrypted private key
   * @returns The decrypted private key
   */
  public decryptPrivateKey(encryptedPrivateKey: string): string {
    try {
      const encryptionKey = config.security.encryptionKey;
      const decrypted = CryptoJS.AES.decrypt(encryptedPrivateKey, encryptionKey).toString(CryptoJS.enc.Utf8);
      
      if (!decrypted) {
        throw new Error('Decryption failed');
      }
      
      return decrypted;
    } catch (error) {
      this.logger.error('Failed to decrypt private key', { error });
      throw new Error('Failed to decrypt private key');
    }
  }

  /**
   * Save wallet to database
   * @param db Database connection
   * @param userId User ID
   * @param wallet Wallet instance
   * @param name Optional wallet name
   * @returns The saved wallet data
   */
  public async saveWallet(db: Knex, userId: number, wallet: ethers.Wallet, name?: string): Promise<WalletData> {
    try {
      // Check if wallet already exists for this user
      const existingWallet = await db('wallets')
        .where({ address: wallet.address, user_id: userId })
        .first();
        
      if (existingWallet) {
        throw new Error('Wallet with this address already exists for this user');
      }
      
      // Encrypt the private key
      const encryptedPrivateKey = this.encryptPrivateKey(wallet.privateKey);
      
      // Create wallet data object
      const walletData: WalletData = {
        userId,
        address: wallet.address,
        encryptedPrivateKey,
        name: name || `Wallet ${wallet.address.substring(0, 6)}...${wallet.address.substring(38)}`,
        isActive: true
      };
      
      // Insert into database
      const [walletId] = await db('wallets').insert({
        user_id: walletData.userId,
        address: walletData.address,
        encrypted_private_key: walletData.encryptedPrivateKey,
        name: walletData.name,
        is_active: walletData.isActive,
        created_at: new Date(),
        updated_at: new Date()
      });
      
      walletData.id = walletId;
      
      this.logger.info('Wallet saved to database', { address: wallet.address });
      return walletData;
    } catch (error) {
      this.logger.error('Failed to save wallet to database', { error, address: wallet.address });
      throw error;
    }
  }

  /**
   * Get all wallets for a user
   * @param db Database connection
   * @param userId User ID
   * @returns Array of wallet data
   */
  public async getUserWallets(db: Knex, userId: number): Promise<WalletData[]> {
    try {
      const wallets = await db('wallets')
        .where({ user_id: userId })
        .select('id', 'address', 'encrypted_private_key as encryptedPrivateKey', 'name', 'is_active as isActive')
        .orderBy('created_at', 'desc');
        
      this.logger.info(`Retrieved ${wallets.length} wallets for user ${userId}`);
      return wallets.map(wallet => ({
        id: wallet.id,
        userId,
        address: wallet.address,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
        name: wallet.name,
        isActive: wallet.isActive
      }));
    } catch (error) {
      this.logger.error('Failed to get user wallets', { error, userId });
      throw error;
    }
  }

  /**
   * Get a specific wallet by ID
   * @param db Database connection
   * @param walletId Wallet ID
   * @param userId User ID (for security check)
   * @returns Wallet data
   */
  public async getWalletById(db: Knex, walletId: number, userId: number): Promise<WalletData> {
    try {
      const wallet = await db('wallets')
        .where({ id: walletId, user_id: userId })
        .first('id', 'address', 'encrypted_private_key as encryptedPrivateKey', 'name', 'is_active as isActive');
        
      if (!wallet) {
        throw new Error('Wallet not found or does not belong to this user');
      }
      
      return {
        id: wallet.id,
        userId,
        address: wallet.address,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
        name: wallet.name,
        isActive: wallet.isActive
      };
    } catch (error) {
      this.logger.error('Failed to get wallet by ID', { error, walletId, userId });
      throw error;
    }
  }

  /**
   * Delete a wallet
   * @param db Database connection
   * @param walletId Wallet ID
   * @param userId User ID (for security check)
   * @returns True if successful
   */
  public async deleteWallet(db: Knex, walletId: number, userId: number): Promise<boolean> {
    try {
      const deleted = await db('wallets')
        .where({ id: walletId, user_id: userId })
        .delete();
        
      if (deleted === 0) {
        throw new Error('Wallet not found or does not belong to this user');
      }
      
      this.logger.info(`Wallet ${walletId} deleted for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to delete wallet', { error, walletId, userId });
      throw error;
    }
  }

  /**
   * Get wallet instance from database
   * @param db Database connection
   * @param walletId Wallet ID
   * @param userId User ID (for security check)
   * @returns Wallet instance
   */
  public async getWalletInstance(db: Knex, walletId: number, userId: number): Promise<ethers.Wallet> {
    try {
      // Get wallet data from database
      const walletData = await this.getWalletById(db, walletId, userId);
      
      // Decrypt private key
      const privateKey = this.decryptPrivateKey(walletData.encryptedPrivateKey);
      
      // Create wallet instance
      const wallet = new ethers.Wallet(privateKey, this.provider);
      
      return wallet;
    } catch (error) {
      this.logger.error('Failed to get wallet instance', { error, walletId, userId });
      throw error;
    }
  }

  /**
   * Get token balances for a wallet
   * @param walletAddress Wallet address
   * @returns Object containing RON, AXS, and SLP balances
   */
  public async getTokenBalances(walletAddress: string): Promise<TokenBalances> {
    try {
      // Get RON balance (native token)
      const ronBalance = await this.provider.getBalance(walletAddress);
      
      // Get AXS balance
      const axsContract = new ethers.Contract(this.axsTokenAddress, ERC20_ABI, this.provider);
      const axsBalance = await axsContract.balanceOf(walletAddress);
      const axsDecimals = await axsContract.decimals();
      
      // Get SLP balance
      const slpContract = new ethers.Contract(this.slpTokenAddress, ERC20_ABI, this.provider);
      const slpBalance = await slpContract.balanceOf(walletAddress);
      const slpDecimals = await slpContract.decimals();
      
      // Format balances to human-readable form
      const formattedRonBalance = ethers.formatEther(ronBalance);
      const formattedAxsBalance = ethers.formatUnits(axsBalance, axsDecimals);
      const formattedSlpBalance = ethers.formatUnits(slpBalance, slpDecimals);
      
      this.logger.info(`Retrieved balances for wallet ${walletAddress}`);
      
      return {
        ron: formattedRonBalance,
        axs: formattedAxsBalance,
        slp: formattedSlpBalance
      };
    } catch (error) {
      this.logger.error('Failed to get token balances', { error, walletAddress });
      throw new Error(`Failed to get token balances: ${(error as Error).message}`);
    }
  }

  /**
   * Estimate gas price based on network conditions and strategy
   * @returns Gas price in wei
   */
  public async estimateGasPrice(): Promise<bigint> {
    try {
      // Get current gas price from provider
      const feeData = await this.provider.getFeeData();
      
      let gasPrice: bigint;
      
      // Apply gas price strategy
      switch (config.blockchain.gasPriceStrategy) {
        case 'fast':
          gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? BigInt(0);
          break;
        case 'fastest':
          // Add 20% to the fast gas price
          gasPrice = feeData.maxFeePerGas ? 
            BigInt(Math.floor(Number(feeData.maxFeePerGas) * 1.2)) : 
            (feeData.gasPrice ? BigInt(Math.floor(Number(feeData.gasPrice) * 1.2)) : BigInt(0));
          break;
        case 'standard':
        default:
          gasPrice = feeData.gasPrice ?? BigInt(0);
          break;
      }
      
      // Apply multiplier from config
      gasPrice = BigInt(Math.floor(Number(gasPrice) * config.blockchain.gasPriceMultiplier));
      
      // Ensure gas price doesn't exceed maximum
      const maxGasPrice = ethers.parseUnits(config.blockchain.maxGasPriceGwei.toString(), 'gwei');
      if (gasPrice > maxGasPrice) {
        gasPrice = maxGasPrice;
      }
      
      return gasPrice;
    } catch (error) {
      this.logger.error('Failed to estimate gas price', { error });
      throw new Error(`Failed to estimate gas price: ${(error as Error).message}`);
    }
  }

  /**
   * Send a transaction
   * @param wallet Wallet instance
   * @param to Recipient address
   * @param value Amount to send (in wei)
   * @param data Transaction data (optional)
   * @returns Transaction receipt
   */
  public async sendTransaction(
    wallet: ethers.Wallet,
    to: string,
    value: bigint,
    data: string = '0x'
  ): Promise<ethers.TransactionReceipt> {
    try {
      // Estimate gas price
      const gasPrice = await this.estimateGasPrice();
      
      // Estimate gas limit
      const gasLimit = await this.provider.estimateGas({
        from: wallet.address,
        to,
        value,
        data
      });
      
      // Apply safety buffer to gas limit (10% extra)
      const safeGasLimit = BigInt(Math.floor(Number(gasLimit) * 1.1));
      
      // Create transaction
      const tx = {
        from: wallet.address,
        to,
        value,
        data,
        gasPrice,
        gasLimit: safeGasLimit
      };
      
      this.logger.info('Sending transaction', { from: wallet.address, to, value: value.toString() });
      
      // Send transaction
      const txResponse = await wallet.sendTransaction(tx);
      
      this.logger.info('Transaction sent', { txHash: txResponse.hash });
      
      // Wait for transaction to be mined
      const receipt = await txResponse.wait();
      
      if (!receipt) {
        throw new Error('Transaction failed: No receipt returned');
      }
      
      this.logger.info('Transaction confirmed', { 
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });
      
      return receipt;
    } catch (error) {
      this.logger.error('Transaction failed', { error, from: wallet.address, to });
      throw new Error(`Transaction failed: ${(error as Error).message}`);
    }
  }

  /**
   * Send ERC-20 tokens
   * @param wallet Wallet instance
   * @param tokenAddress Token contract address
   * @param to Recipient address
   * @param amount Amount to send (in token's smallest unit)
   * @returns Transaction receipt
   */
  public async sendToken(
    wallet: ethers.Wallet,
    tokenAddress: string,
    to: string,
    amount: bigint
  ): Promise<ethers.TransactionReceipt> {
    try {
      // Create contract instance
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      
      // Estimate gas price
      const gasPrice = await this.estimateGasPrice();
      
      this.logger.info('Sending tokens', { 
        from: wallet.address, 
        to, 
        tokenAddress,
        amount: amount.toString() 
      });
      
      // Send tokens
      const txResponse = await tokenContract.transfer(to, amount, {
        gasPrice,
        gasLimit: config.blockchain.defaultGasLimit
      });
      
      this.logger.info('Token transfer sent', { txHash: txResponse.hash });
      
      // Wait for transaction to be mined
      const receipt = await txResponse.wait();
      
      if (!receipt) {
        throw new Error('Token transfer failed: No receipt returned');
      }
      
      this.logger.info('Token transfer confirmed', { 
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });
      
      return receipt;
    } catch (error) {
      this.logger.error('Token transfer failed', { error, from: wallet.address, to, tokenAddress });
      throw new Error(`Token transfer failed: ${(error as Error).message}`);
    }
  }

  /**
   * Approve token spending for a contract
   * @param wallet Wallet instance
   * @param tokenAddress Token contract address
   * @param spenderAddress Address of the contract to approve
   * @param amount Amount to approve (in token's smallest unit)
   * @returns Transaction receipt
   */
  public async approveTokenSpending(
    wallet: ethers.Wallet,
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint
  ): Promise<ethers.TransactionReceipt> {
    try {
      // Create contract instance
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      
      // Estimate gas price
      const gasPrice = await this.estimateGasPrice();
      
      this.logger.info('Approving token spending', { 
        from: wallet.address, 
        spender: spenderAddress, 
        tokenAddress,
        amount: amount.toString() 
      });
      
      // Approve token spending
      const txResponse = await tokenContract.approve(spenderAddress, amount, {
        gasPrice,
        gasLimit: config.blockchain.defaultGasLimit
      });
      
      this.logger.info('Token approval sent', { txHash: txResponse.hash });
      
      // Wait for transaction to be mined
      const receipt = await txResponse.wait();
      
      if (!receipt) {
        throw new Error('Token approval failed: No receipt returned');
      }
      
      this.logger.info('Token approval confirmed', { 
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });
      
      return receipt;
    } catch (error) {
      this.logger.error('Token approval failed', { error, from: wallet.address, spender: spenderAddress, tokenAddress });
      throw new Error(`Token approval failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check if an address is valid
   * @param address Address to validate
   * @returns True if address is valid
   */
  public isValidAddress(address: string): boolean {
    try {
      return ethers.isAddress(address);
    } catch (error) {
      return false;
    }
  }

  /**
   * Format address to checksum format
   * @param address Address to format
   * @returns Checksum address
   */
  public formatAddress(address: string): string {
    try {
      return ethers.getAddress(address);
    } catch (error) {
      this.logger.error('Failed to format address', { error, address });
      throw new Error('Invalid address format');
    }
  }

  /**
   * Convert RON to wei
   * @param amount Amount in RON
   * @returns Amount in wei
   */
  public ronToWei(amount: string | number): bigint {
    try {
      return ethers.parseEther(amount.toString());
    } catch (error) {
      this.logger.error('Failed to convert RON to wei', { error, amount });
      throw new Error('Invalid amount format');
    }
  }

  /**
   * Convert wei to RON
   * @param amount Amount in wei
   * @returns Amount in RON
   */
  public weiToRon(amount: bigint): string {
    try {
      return ethers.formatEther(amount);
    } catch (error) {
      this.logger.error('Failed to convert wei to RON', { error, amount: amount.toString() });
      throw new Error('Invalid amount format');
    }
  }
}

export default WalletService;
