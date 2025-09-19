import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { createLogger, format, transports } from 'winston';

// Load environment variables
dotenv.config();

// Set up logger
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...rest }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(rest).length ? JSON.stringify(rest, null, 2) : ''}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'interface-test.log' })
  ]
});

// Contract addresses for mainnet
const MAINNET = {
  MARKET_GATEWAY: "0x3b3adf1422f84254b7fbb0e7ca62bd0865133fe3", // deprecated gateway
  MARKET_GATEWAY_MULTISEND: "0x21a0a1c081dc2f3e48dc391786f53035f85ce0bc", // current gateway
  WETH: "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5",
  AXIE: "0x32950db2a7164aE833121501C797D79E7B79d74C",
  RONIN_RPC: "https://api.roninchain.com/rpc",
  DOMAIN_CHAIN_ID: 2020,
};

// Interface names to test
const INTERFACE_NAMES = [
  'ORDER_EXCHANGE',
  'ERC721_MARKET_GATEWAY',
  'ERC_721',
  'MARKET_GATEWAY',
  'AXIE',
  'ORDER_EXCHANGE_V1',
  'ORDER_EXCHANGE_V2',
  'AXIE_MARKETPLACE',
  'MARKETPLACE',
  'NFT_MARKETPLACE'
];

// ABI for the Market Gateway Multisend contract
const MARKET_GATEWAY_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "marketGateway",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "string",
            "name": "interfaceName",
            "type": "string"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "paymentToken",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "value",
            "type": "uint256"
          }
        ],
        "internalType": "tuple[]",
        "name": "params",
        "type": "tuple[]"
      },
      {
        "internalType": "bool",
        "name": "requiredAllSuccess",
        "type": "bool"
      }
    ],
    "name": "bulkInteractWith",
    "outputs": [
      {
        "internalType": "bytes[]",
        "name": "",
        "type": "bytes[]"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  }
];

// Dummy data for a minimal test transaction
const DUMMY_DATA = "0x12345678";

/**
 * Test a specific interface name
 * @param provider The ethers provider
 * @param wallet The wallet to use for signing
 * @param interfaceName The interface name to test
 */
async function testInterfaceName(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  interfaceName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info(`Testing interface name: ${interfaceName}`);
    
    // Create contract instance
    const contract = new ethers.Contract(
      MAINNET.MARKET_GATEWAY_MULTISEND,
      MARKET_GATEWAY_ABI,
      wallet
    );
    
    // Create minimal batch params
    const batchParams = [
      {
        interfaceName: interfaceName,
        data: DUMMY_DATA,
        paymentToken: MAINNET.WETH,
        value: BigInt(0)
      }
    ];
    
    // Estimate gas to see if the interface name is recognized
    // This will fail with "query for unsupported interface" if the name is wrong
    try {
      const gasEstimate = await contract.bulkInteractWith.estimateGas(
        MAINNET.MARKET_GATEWAY,
        batchParams,
        false,
        { value: BigInt(0) }
      );
      
      logger.info(`Interface name ${interfaceName} is VALID! Gas estimate: ${gasEstimate}`);
      return { success: true };
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      
      // Check if the error is specifically about unsupported interface
      const isInterfaceError = errorMessage.includes('query for unsupported interface');
      
      if (isInterfaceError) {
        logger.info(`Interface name ${interfaceName} is INVALID: ${errorMessage}`);
        return { success: false, error: errorMessage };
      } else {
        // If it's a different error, the interface might be valid but there's another issue
        logger.info(`Interface name ${interfaceName} might be valid, but got different error: ${errorMessage}`);
        return { success: true, error: errorMessage };
      }
    }
  } catch (error: any) {
    logger.error(`Error testing interface name ${interfaceName}:`, error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Main function to run the interface test
 */
async function main() {
  try {
    logger.info('Starting interface name test...');
    
    // Get private key from environment variables
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('WALLET_PRIVATE_KEY environment variable is not set');
    }
    
    // Create provider and wallet
    const provider = new ethers.JsonRpcProvider(MAINNET.RONIN_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    logger.info(`Using wallet address: ${wallet.address}`);
    
    // Test each interface name
    const results = [];
    for (const interfaceName of INTERFACE_NAMES) {
      const result = await testInterfaceName(provider, wallet, interfaceName);
      results.push({
        interfaceName,
        valid: result.success,
        error: result.error
      });
    }
    
    // Log summary of results
    logger.info('===== INTERFACE NAME TEST RESULTS =====');
    const validInterfaces = results.filter(r => r.valid).map(r => r.interfaceName);
    const invalidInterfaces = results.filter(r => !r.valid).map(r => r.interfaceName);
    
    logger.info(`VALID INTERFACE NAMES: ${validInterfaces.join(', ') || 'None'}`);
    logger.info(`INVALID INTERFACE NAMES: ${invalidInterfaces.join(', ') || 'None'}`);
    
    // Detailed results
    logger.info('Detailed Results:');
    results.forEach(result => {
      logger.info(`${result.interfaceName}: ${result.valid ? 'VALID' : 'INVALID'}${result.error ? ` (${result.error})` : ''}`);
    });
    
    logger.info('Interface name test completed');
  } catch (error) {
    logger.error('Error running interface test:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
