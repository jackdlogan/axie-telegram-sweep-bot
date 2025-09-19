import { ethers, FetchRequest } from 'ethers';
import config from '../config';
import Logger from '../utils/logger';
import { ERC20_ABI, ERC721_ABI } from '../contracts/abis';

/**
 * Interface for token balances
 */
export interface TokenBalances {
  ron: string;          // RON balance in ETH format (e.g., "1.25")
  weth: string;         // WETH balance in ETH format
  ronWei: bigint;       // RON balance in Wei (raw format)
  wethWei: bigint;      // WETH balance in Wei (raw format)
}

/**
 * Interface for approval result
 */
export interface ApprovalResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Interface for allowance check result
 */
export interface AllowanceResult {
  allowance: bigint;    // Amount approved in Wei
  allowanceFormatted: string; // Amount in ETH format
  sufficientForAmount?: boolean; // Whether allowance is sufficient for a specific amount
}

/**
 * Service for managing token operations (WETH and RON)
 */
class TokenService {
  private logger: Logger;
  private provider: ethers.JsonRpcProvider;
  private wethContract: ethers.Contract;
  
  /**
   * Constructor
   */
  constructor() {
    this.logger = new Logger('token-service');
    
    // Initialize provider with Ronin RPC
    // NOTE: JsonRpcProvider does not expose a public `connection.headers`
    // property, so we simply use the configured RPC URL (add the API-KEY
    // as a query parameter on the URL itself if the endpoint requires it).
    const rpcUrl = config.blockchain.roninMainnetRpc;
    const apiKey = config.blockchain.roninApiKey;

    /**
     * If we are using the official Sky Mavis RPC (`api-gateway.skymavis.com`)
     * AND an API key is provided, we attach the key in the request headers.
     * Otherwise fall back to the simple URL-only provider (public RPC or
     * 3rd-party endpoints that don’t require authentication).
     */
    if (rpcUrl.includes('api-gateway.skymavis.com') && apiKey) {
      // Build FetchRequest with X-API-KEY header (lower-case per docs)
      const req = new FetchRequest(rpcUrl);
      req.setHeader('x-api-key', apiKey);

      // Chain ID 2020 = Ronin mainnet – avoids “unknown network” warning
      this.provider = new ethers.JsonRpcProvider(req, 2020);
      this.logger.info('Token service initialized with Sky Mavis RPC (auth header)');
    } else {
      // Always pass chainId to avoid ENS-related errors on Ronin network
      this.provider = new ethers.JsonRpcProvider(rpcUrl, 2020);
      this.logger.info('Token service initialized with public / custom RPC');
    }
    
    // Initialize WETH contract
    this.wethContract = new ethers.Contract(
      config.blockchain.wethTokenAddress,
      ERC20_ABI,
      this.provider
    );
    
  }

  /**
   * Get native ETH (RON) balance for an address (formatted number)
   * @param address Wallet address
   */
  public async getEthBalance(address: string): Promise<number> {
    const balanceWei = await this.provider.getBalance(address);
    return parseFloat(ethers.formatEther(balanceWei));
  }

  /**
   * Get RON balance – alias of getEthBalance for clarity
   * @param address Wallet address
   */
  public async getRonBalance(address: string): Promise<number> {
    return this.getEthBalance(address);
  }

  /**
   * Get WETH (Wrapped ETH) balance for an address (formatted number)
   * @param address Wallet address
   */
  public async getWethBalance(address: string): Promise<number> {
    // Directly query the WETH ERC-20 contract
    const wethWei = await this.wethContract.balanceOf(address);
    return parseFloat(ethers.formatEther(wethWei));
  }

  /**
   * Get a connected instance of the Axie NFT contract
   * Used for reading tokenIds owned by a wallet
   */
  public getAxieContract(): ethers.Contract {
    return new ethers.Contract(
      config.blockchain.axieNftContractAddress,
      ERC721_ABI,
      this.provider
    );
  }
  
  /**
   * Get token balances for an address
   * @param address Wallet address
   * @returns Token balances
   */
  public async getTokenBalances(address: string): Promise<TokenBalances> {
    try {
      // Get RON balance (native token)
      const ronWei = await this.provider.getBalance(address);
      
      // Get WETH balance
      const wethWei = await this.wethContract.balanceOf(address);
      
      // Convert to formatted strings
      const ron = ethers.formatEther(ronWei);
      const weth = ethers.formatEther(wethWei);
      
      this.logger.debug('Retrieved token balances', { address, ron, weth });
      
      return {
        ron,
        weth,
        ronWei,
        wethWei
      };
    } catch (error) {
      this.logger.error('Failed to get token balances', { error, address });
      throw new Error(`Failed to get token balances: ${(error as Error).message}`);
    }
  }
  
  /**
   * Check if wallet has sufficient token balance
   * @param address Wallet address
   * @param amount Amount to check (in ETH format)
   * @param token Token to check ('ron' or 'weth')
   * @returns Whether balance is sufficient
   */
  public async hasSufficientBalance(
    address: string,
    amount: string,
    token: 'ron' | 'weth'
  ): Promise<boolean> {
    try {
      const balances = await this.getTokenBalances(address);
      // Limit the decimal precision to 18 places before converting.
      const roundedAmount = parseFloat(amount).toFixed(18);
      const amountWei = ethers.parseEther(roundedAmount);
      
      if (token === 'ron') {
        return balances.ronWei >= amountWei;
      } else {
        return balances.wethWei >= amountWei;
      }
    } catch (error) {
      this.logger.error('Failed to check token balance', { error, address, amount, token });
      throw new Error(`Failed to check token balance: ${(error as Error).message}`);
    }
  }
  
  /**
   * Check allowance for WETH spending
   * @param ownerAddress Owner wallet address
   * @param spenderAddress Spender address (usually marketplace contract)
   * @param amount Optional amount to check if allowance is sufficient (in ETH format)
   * @returns Allowance information
   */
  public async checkAllowance(
    ownerAddress: string,
    spenderAddress: string = config.blockchain.marketplaceContractAddress,
    amount?: string
  ): Promise<AllowanceResult> {
    try {
      const allowance = await this.wethContract.allowance(ownerAddress, spenderAddress);
      const allowanceFormatted = ethers.formatEther(allowance);
      
      let sufficientForAmount: boolean | undefined;
      
      if (amount) {
        const roundedAmount = parseFloat(amount).toFixed(18);
        const amountWei = ethers.parseEther(roundedAmount);
        sufficientForAmount = allowance >= amountWei;
      }
      
      this.logger.debug('Checked WETH allowance', {
        owner: ownerAddress,
        spender: spenderAddress,
        allowance: allowanceFormatted,
        sufficientForAmount
      });
      
      return {
        allowance,
        allowanceFormatted,
        sufficientForAmount
      };
    } catch (error) {
      this.logger.error('Failed to check WETH allowance', {
        error,
        owner: ownerAddress,
        spender: spenderAddress
      });
      throw new Error(`Failed to check WETH allowance: ${(error as Error).message}`);
    }
  }
  
  /**
   * Approve WETH spending for marketplace
   * @param wallet Signer wallet
   * @param amount Amount to approve (in ETH format)
   * @param spenderAddress Spender address (defaults to marketplace contract)
   * @returns Approval result
   */
  public async approveWeth(
    wallet: ethers.Wallet,
    amount: string,
    spenderAddress: string = config.blockchain.marketplaceContractAddress
  ): Promise<ApprovalResult> {
    try {
      // Connect wallet to WETH contract
      // Cast to any so TypeScript doesn't complain about dynamically
      // generated contract methods (approve, estimateGas.approve, …)
      const wethWithSigner = this.wethContract.connect(wallet) as any;
      
      // Convert amount to Wei
      const roundedAmount = parseFloat(amount).toFixed(18);
      const amountWei = ethers.parseEther(roundedAmount);
      
      // Check current allowance
      const currentAllowance = await this.checkAllowance(wallet.address, spenderAddress);
      
      // If already approved for sufficient amount, return success
      if (currentAllowance.sufficientForAmount) {
        this.logger.info('WETH already approved for sufficient amount', {
          address: wallet.address,
          spender: spenderAddress,
          amount,
          currentAllowance: currentAllowance.allowanceFormatted
        });
        
        return {
          success: true
        };
      }
      
      // Estimate gas for approval
      const gasEstimate = await wethWithSigner.approve.estimateGas(
        spenderAddress,
        amountWei
      );
      
      // Add 20% buffer to gas estimate
      const gasLimit = gasEstimate * BigInt(120) / BigInt(100);
      
      // Send approval transaction
      const tx = await wethWithSigner.approve(spenderAddress, amountWei, {
        gasLimit
      });
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      this.logger.info('WETH approval successful', {
        address: wallet.address,
        spender: spenderAddress,
        amount,
        transactionHash: receipt?.hash
      });
      
      return {
        success: true,
        transactionHash: receipt?.hash
      };
    } catch (error) {
      this.logger.error('Failed to approve WETH spending', {
        error,
        address: wallet.address,
        spender: spenderAddress,
        amount
      });
      
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Get information about WETH token
   * @returns Token information
   */
  public async getWethInfo(): Promise<{ symbol: string; decimals: number }> {
    try {
      const symbol = await this.wethContract.symbol();
      const decimals = await this.wethContract.decimals();
      
      return { symbol, decimals };
    } catch (error) {
      this.logger.error('Failed to get WETH token info', { error });
      throw new Error(`Failed to get WETH token info: ${(error as Error).message}`);
    }
  }
  
  /**
   * Get instructions for wrapping RON to WETH
   * Note: Direct wrapping through contract is not implemented as it requires
   * specific knowledge of the Ronin WETH contract implementation.
   * @returns Instructions for wrapping
   */
  public getWrapInstructions(): string {
    return `To wrap RON to WETH:
1. Visit the Ronin Wallet interface at https://wallet.roninchain.com/
2. Connect your wallet
3. Navigate to the Swap feature
4. Select RON as the source token and WETH as the target token
5. Enter the amount you wish to wrap
6. Confirm the transaction

Alternatively, you can use the Katana DEX at https://katana.roninchain.com/`;
  }
  
  /**
   * Get instructions for unwrapping WETH to RON
   * @returns Instructions for unwrapping
   */
  public getUnwrapInstructions(): string {
    return `To unwrap WETH back to RON:
1. Visit the Ronin Wallet interface at https://wallet.roninchain.com/
2. Connect your wallet
3. Navigate to the Swap feature
4. Select WETH as the source token and RON as the target token
5. Enter the amount you wish to unwrap
6. Confirm the transaction

Alternatively, you can use the Katana DEX at https://katana.roninchain.com/`;
  }
  
  /**
   * Create a connected instance of the token service with a wallet
   * @param wallet Signer wallet
   * @returns Connected token service
   */
  public connect(wallet: ethers.Wallet): ConnectedTokenService {
    return new ConnectedTokenService(this, wallet);
  }
}

/**
 * Connected version of the token service with a wallet
 * Provides simplified methods that use the connected wallet
 */
class ConnectedTokenService {
  private tokenService: TokenService;
  private wallet: ethers.Wallet;
  
  constructor(tokenService: TokenService, wallet: ethers.Wallet) {
    this.tokenService = tokenService;
    this.wallet = wallet;
  }
  
  /**
   * Get token balances for the connected wallet
   * @returns Token balances
   */
  public async getBalances(): Promise<TokenBalances> {
    return this.tokenService.getTokenBalances(this.wallet.address);
  }
  
  /**
   * Check if wallet has sufficient token balance
   * @param amount Amount to check (in ETH format)
   * @param token Token to check ('ron' or 'weth')
   * @returns Whether balance is sufficient
   */
  public async hasSufficientBalance(amount: string, token: 'ron' | 'weth'): Promise<boolean> {
    return this.tokenService.hasSufficientBalance(this.wallet.address, amount, token);
  }
  
  /**
   * Check allowance for WETH spending
   * @param spenderAddress Spender address (usually marketplace contract)
   * @param amount Optional amount to check if allowance is sufficient
   * @returns Allowance information
   */
  public async checkAllowance(
    spenderAddress: string = config.blockchain.marketplaceContractAddress,
    amount?: string
  ): Promise<AllowanceResult> {
    return this.tokenService.checkAllowance(this.wallet.address, spenderAddress, amount);
  }
  
  /**
   * Approve WETH spending for marketplace
   * @param amount Amount to approve (in ETH format)
   * @param spenderAddress Spender address (defaults to marketplace contract)
   * @returns Approval result
   */
  public async approveWeth(
    amount: string,
    spenderAddress: string = config.blockchain.marketplaceContractAddress
  ): Promise<ApprovalResult> {
    return this.tokenService.approveWeth(this.wallet, amount, spenderAddress);
  }
}

export default TokenService;
