import { ethers, FetchRequest } from 'ethers';
import Logger from '../utils/logger';
import config from '../config';

/**
 * ABI for the SafeBatchTransfer contract
 * This contract allows batch transfers of ERC-721 tokens
 */
export const SAFE_BATCH_TRANSFER_ABI = [
  // Transfer multiple NFTs to a single recipient
  {
    "inputs": [
      {
        "internalType": "contract IERC721",
        "name": "_tokenContract",
        "type": "address"
      },
      {
        "internalType": "uint256[]",
        "name": "_ids",
        "type": "uint256[]"
      },
      {
        "internalType": "address",
        "name": "_recipient",
        "type": "address"
      }
    ],
    "name": "safeBatchTransfer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // Transfer multiple NFTs to multiple recipients (1:1 mapping)
  {
    "inputs": [
      {
        "internalType": "contract IERC721",
        "name": "_tokenContract",
        "type": "address"
      },
      {
        "internalType": "uint256[]",
        "name": "_ids",
        "type": "uint256[]"
      },
      {
        "internalType": "address[]",
        "name": "_recipients",
        "type": "address[]"
      }
    ],
    "name": "safeBatchTransfer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

/**
 * ABI for checking and setting ERC-721 approvals
 */
export const ERC721_APPROVAL_ABI = [
  // Check if an operator is approved for all tokens
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      }
    ],
    "name": "isApprovedForAll",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Set approval for all tokens
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "approved",
        "type": "bool"
      }
    ],
    "name": "setApprovalForAll",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

/**
 * Interface for transfer result
 */
export interface TransferResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * SafeBatchTransfer Contract for transferring multiple Axies in a single transaction
 */
export default class SafeBatchTransferContract {
  private readonly contractAddress: string = '0x2368dfed532842db89b470fde9fd584d48d4f644';
  private readonly axieContractAddress: string = config.blockchain.axieNftContractAddress;
  private logger: Logger;
  private provider: ethers.JsonRpcProvider;
  
  /**
   * Constructor
   * @param provider Optional provider (will create one if not provided)
   */
  constructor(provider?: ethers.JsonRpcProvider) {
    this.logger = new Logger('safe-batch-transfer-contract');
    
    if (provider) {
      this.provider = provider;
    } else {
      // Initialize provider with proper authentication for Ronin mainnet
      const rpcUrl = config.blockchain.roninMainnetRpc;
      // Use the correct API-key field from config
      const apiKey = config.api.axieGraphqlApiKey;
      
      if (rpcUrl.includes('api-gateway.skymavis.com') && apiKey) {
        // Build FetchRequest with X-API-KEY header (lower-case per docs)
        const req = new FetchRequest(rpcUrl);
        req.setHeader('x-api-key', apiKey);
        
        // Chain ID 2020 = Ronin mainnet
        this.provider = new ethers.JsonRpcProvider(req, 2020);
        this.logger.info('SafeBatchTransfer contract initialized with authenticated Sky Mavis RPC');
      } else {
        // Fallback to regular provider
        this.provider = new ethers.JsonRpcProvider(
          rpcUrl,
          {
            chainId: 2020, // Ronin chain ID
            name: 'ronin'
          }
        );
        this.logger.info('SafeBatchTransfer contract initialized with standard RPC');
      }
    }
    
    this.logger.info('SafeBatchTransfer contract initialized', {
      contractAddress: this.contractAddress,
      axieContractAddress: this.axieContractAddress
    });
  }
  
  /**
   * Connect wallet to the contract
   * @param wallet Wallet to connect
   * @returns Connected contract instance
   */
  private getConnectedContract(wallet: ethers.Wallet): ethers.Contract {
    return new ethers.Contract(
      this.contractAddress,
      SAFE_BATCH_TRANSFER_ABI,
      wallet
    );
  }
  
  /**
   * Get Axie contract instance
   * @param wallet Wallet to connect (optional)
   * @returns Connected Axie contract instance
   */
  private getAxieContract(wallet?: ethers.Wallet): ethers.Contract {
    const signer = wallet || this.provider;
    return new ethers.Contract(
      this.axieContractAddress,
      ERC721_APPROVAL_ABI,
      signer
    );
  }
  
  /**
   * Check if the batch transfer contract is approved to transfer Axies
   * @param walletAddress Owner wallet address
   * @returns Whether the contract is approved
   */
  public async isApprovedForAll(walletAddress: string): Promise<boolean> {
    try {
      // Convert ronin: format to 0x format if needed
      const normalizedAddress = walletAddress.startsWith('ronin:')
        ? '0x' + walletAddress.substring(6)
        : walletAddress;

      const axieContract = this.getAxieContract();
      const isApproved = await axieContract.isApprovedForAll(
        normalizedAddress,
        this.contractAddress
      );
      
      this.logger.debug('Checked approval status', {
        walletAddress,
        normalizedAddress,
        contractAddress: this.contractAddress,
        isApproved
      });
      
      return isApproved;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to check approval status', {
        error: errorMessage,
        walletAddress
      });
      throw new Error(`Failed to check approval status: ${errorMessage}`);
    }
  }
  
  /**
   * Approve the batch transfer contract to transfer all Axies
   * @param wallet Wallet to approve from
   * @returns Transaction result
   */
  public async setApprovalForAll(wallet: ethers.Wallet): Promise<TransferResult> {
    try {
      const walletAddress = await wallet.getAddress();
      // Convert ronin: format to 0x format if needed
      const normalizedAddress = walletAddress.startsWith('ronin:')
        ? '0x' + walletAddress.substring(6)
        : walletAddress;
      
      // Check if already approved
      const isApproved = await this.isApprovedForAll(normalizedAddress);
      if (isApproved) {
        this.logger.info('Contract already approved for all Axies', {
          walletAddress
        });
        return {
          success: true
        };
      }
      
      // Set approval
      const axieContract = this.getAxieContract(wallet);
      const tx = await axieContract.setApprovalForAll(
        this.contractAddress,
        true
      );
      
      this.logger.info('Approval transaction sent', {
        txHash: tx.hash,
        walletAddress,
        contractAddress: this.contractAddress
      });
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      if (!receipt || receipt.status !== 1) {
        throw new Error('Approval transaction failed');
      }
      
      return {
        success: true,
        txHash: receipt.transactionHash
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to approve contract', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }
  
  /**
   * Transfer multiple Axies to a single recipient
   * @param wallet Wallet to transfer from
   * @param axieIds Array of Axie IDs to transfer
   * @param recipientAddress Recipient wallet address
   * @returns Transfer result
   */
  public async batchTransferToSingleRecipient(
    wallet: ethers.Wallet,
    axieIds: string[],
    recipientAddress: string
  ): Promise<TransferResult> {
    try {
      if (!axieIds || axieIds.length === 0) {
        throw new Error('No Axie IDs provided');
      }
      
      const walletAddress = await wallet.getAddress();
      // Convert ronin: format to 0x format if needed
      const normalizedAddress = walletAddress.startsWith('ronin:')
        ? '0x' + walletAddress.substring(6)
        : walletAddress;
      
      // Check if approved
      const isApproved = await this.isApprovedForAll(normalizedAddress);
      if (!isApproved) {
        this.logger.info('Contract not approved, setting approval', {
          walletAddress
        });
        
        const approvalResult = await this.setApprovalForAll(wallet);
        if (!approvalResult.success) {
          throw new Error(`Failed to approve contract: ${approvalResult.error}`);
        }
      }
      
      // Convert string IDs to BigInts for the contract call
      const axieIdsBigInt = axieIds.map(id => BigInt(id));
      
      // Get connected contract
      const contract = this.getConnectedContract(wallet);
      
      // Execute batch transfer - explicitly call the single-recipient
      // overload to avoid the “ambiguous function description” error.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore – bracket-notation required for overloaded function
      const tx = await contract['safeBatchTransfer(address,uint256[],address)'](
        this.axieContractAddress,
        axieIdsBigInt,
        recipientAddress
      );
      
      this.logger.info('Batch transfer transaction sent', {
        txHash: tx.hash,
        from: walletAddress,
        to: recipientAddress,
        axieCount: axieIds.length,
        axieIds
      });
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      if (!receipt || receipt.status !== 1) {
        throw new Error('Batch transfer transaction failed');
      }
      
      return {
        success: true,
        txHash: receipt.transactionHash
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to batch transfer Axies', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        axieIds,
        recipientAddress
      });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }
  
  /**
   * Transfer multiple Axies to multiple recipients (1:1 mapping)
   * @param wallet Wallet to transfer from
   * @param axieIds Array of Axie IDs to transfer
   * @param recipientAddresses Array of recipient wallet addresses (must match axieIds length)
   * @returns Transfer result
   */
  public async batchTransferToMultipleRecipients(
    wallet: ethers.Wallet,
    axieIds: string[],
    recipientAddresses: string[]
  ): Promise<TransferResult> {
    try {
      if (!axieIds || axieIds.length === 0) {
        throw new Error('No Axie IDs provided');
      }
      
      if (!recipientAddresses || recipientAddresses.length === 0) {
        throw new Error('No recipient addresses provided');
      }
      
      if (axieIds.length !== recipientAddresses.length) {
        throw new Error('Number of Axie IDs must match number of recipient addresses');
      }
      
      const walletAddress = await wallet.getAddress();
      
      // Check if approved
      const isApproved = await this.isApprovedForAll(walletAddress);
      if (!isApproved) {
        this.logger.info('Contract not approved, setting approval', {
          walletAddress
        });
        
        const approvalResult = await this.setApprovalForAll(wallet);
        if (!approvalResult.success) {
          throw new Error(`Failed to approve contract: ${approvalResult.error}`);
        }
      }
      
      // Convert string IDs to BigInts for the contract call
      const axieIdsBigInt = axieIds.map(id => BigInt(id));
      
      // Get connected contract
      const contract = this.getConnectedContract(wallet);
      
      // Execute batch transfer - explicitly call the multi-recipient
      // overload to avoid the “ambiguous function description” error.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore – bracket-notation required for overloaded function
      const tx = await contract['safeBatchTransfer(address,uint256[],address[])'](
        this.axieContractAddress,
        axieIdsBigInt,
        recipientAddresses
      );
      
      this.logger.info('Batch transfer transaction sent', {
        txHash: tx.hash,
        from: walletAddress,
        recipientCount: recipientAddresses.length,
        axieCount: axieIds.length,
        axieIds,
        recipientAddresses
      });
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      if (!receipt || receipt.status !== 1) {
        throw new Error('Batch transfer transaction failed');
      }
      
      return {
        success: true,
        txHash: receipt.transactionHash
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to batch transfer Axies to multiple recipients', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        axieIds,
        recipientAddresses
      });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}
