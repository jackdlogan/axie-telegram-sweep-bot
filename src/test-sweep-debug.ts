import { ethers } from 'ethers';
import dotenv from 'dotenv';
import MarketGatewayContract from './contracts/marketGateway';
import MarketplaceService, { AxieCollection } from './services/marketplaceService';
import SweepService from './services/sweepService';
import WalletService from './services/walletService';
import TokenService from './services/tokenService';
import Logger from './utils/logger';
import { Knex } from 'knex';
import knexConfig from '../knexfile';
import knex from 'knex';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = new Logger('sweep-debug');

// Contract addresses
const TESTNET = {
  MARKET_GATEWAY: "0x2488a13a4d635b0bacf7ef59911e54efeaf573eb",
  MARKET_GATEWAY_MULTISEND: "0x5079b2672284570d3f56b7244f5da109c782f940",
  WETH: "0x29C6F8349A028E1bdfC68BFa08BDee7bC5D47E16",
  AXIE: "0xcaCA1c072D26E46686d932686015207FbE08FdB8",
  RONIN_RPC: "https://saigon-testnet.roninchain.com/rpc",
  GRAPHQL_ENDPOINT: "https://dev-app-axie-graphql.skymavis.one/graphql",
  DOMAIN_CHAIN_ID: 2021,
};

const MAINNET = {
  MARKET_GATEWAY: "0x3b3adf1422f84254b7fbb0e7ca62bd0865133fe3", // deprecated gateway
  MARKET_GATEWAY_MULTISEND: "0x21a0a1c081dc2f3e48dc391786f53035f85ce0bc", // current gateway
  WETH: "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5",
  AXIE: "0x32950db2a7164aE833121501C797D79E7B79d74C",
  RONIN_RPC: "https://api.roninchain.com/rpc",
  GRAPHQL_ENDPOINT: "https://graphql-gateway.axieinfinity.com/graphql",
  DOMAIN_CHAIN_ID: 2020,
};

// Interface names to test
const INTERFACE_NAMES = [
  'ORDER_EXCHANGE',
  'ERC721_MARKET_GATEWAY',
  'ERC_721',
  'MARKET_GATEWAY',
  'AXIE'
];

// Database connection
const db: Knex = knex(knexConfig.development);

// Initialize services
const marketplaceService = new MarketplaceService();
const walletService = new WalletService();
const tokenService = new TokenService();
const sweepService = new SweepService();

/**
 * Debug the order encoding process
 * @param axieOrder The order to encode
 * @param gatewayContract The gateway contract instance
 */
async function debugOrderEncoding(axieOrder: any, gatewayContract: MarketGatewayContract) {
  try {
    // Show original order
    logger.info('Original Order:', { 
      id: axieOrder.id,
      maker: axieOrder.maker,
      kind: axieOrder.kind,
      expiredAt: axieOrder.expiredAt,
      nonce: axieOrder.nonce,
      expectedState: axieOrder.expectedState,
      signature: axieOrder.signature ? `${axieOrder.signature.substring(0, 10)}...` : 'MISSING'
    });
    
    // Prepare order for encoding
    const order = await sweepService['prepareOrder'](axieOrder);
    
    // Show prepared order
    logger.info('Prepared Order:', {
      maker: order.maker,
      kind: order.kind,
      kindValue: order.kind === 0 ? 'Sell (0)' : 'Offer (1)',
      assets: order.assets.map(a => ({
        erc: a.erc,
        addr: a.addr,
        id: a.id,
        quantity: a.quantity
      })),
      expiredAt: order.expiredAt,
      paymentToken: order.paymentToken,
      expectedState: order.expectedState,
      nonce: order.nonce
    });
    
    // Encode the order
    const encodedOrder = gatewayContract.encodeOrder(order);
    
    // Show encoded order (truncated for readability)
    logger.info('Encoded Order:', {
      length: encodedOrder.length,
      preview: `${encodedOrder.substring(0, 50)}...`
    });
    
    return { order, encodedOrder };
  } catch (error) {
    logger.error('Error encoding order:', error);
    throw error;
  }
}

/**
 * Debug the settlement parameters
 * @param order The prepared order
 * @param signature The order signature
 * @param expectedState The expected state
 * @param settlePrice The settlement price
 * @param gatewayContract The gateway contract instance
 */
async function debugSettlementParams(
  order: any,
  signature: string,
  expectedState: string,
  settlePrice: string,
  gatewayContract: MarketGatewayContract
) {
  try {
    // Get signer address
    const signerAddress = await gatewayContract['signer'].getAddress();
    
    // Determine recipient based on order kind
    const recipient = order.kind === 1 ? order.maker : signerAddress;
    
    // Create order settlement parameters
    const orderInfo = {
      orderData: gatewayContract.encodeOrder(order),
      signature: signature,
      referralAddr: ethers.ZeroAddress,
      expectedState: BigInt(expectedState),
      recipient,
      refunder: signerAddress,
    };
    
    // Show settlement parameters
    logger.info('Settlement Parameters:', {
      orderData: `${orderInfo.orderData.substring(0, 30)}...`,
      signatureLength: orderInfo.signature?.length,
      referralAddr: orderInfo.referralAddr,
      expectedState: orderInfo.expectedState.toString(),
      recipient: orderInfo.recipient,
      refunder: orderInfo.refunder,
      settlePrice
    });
    
    return orderInfo;
  } catch (error) {
    logger.error('Error creating settlement parameters:', error);
    throw error;
  }
}

/**
 * Debug the batch parameters for bulkInteractWith
 * @param interfaceName The interface name to use
 * @param encodedParams The encoded function call data
 * @param paymentToken The payment token address
 * @param settlePrice The settlement price
 */
function debugBatchParams(
  interfaceName: string,
  encodedParams: string,
  paymentToken: string,
  settlePrice: string
) {
  try {
    // Create batch parameters
    const batchParams = {
      interfaceName,
      data: encodedParams,
      paymentToken,
      value: BigInt(settlePrice)
    };
    
    // Show batch parameters
    logger.info('Batch Parameters:', {
      interfaceName: batchParams.interfaceName,
      dataLength: batchParams.data.length,
      dataPreview: `${batchParams.data.substring(0, 30)}...`,
      paymentToken: batchParams.paymentToken,
      value: batchParams.value.toString()
    });
    
    return batchParams;
  } catch (error) {
    logger.error('Error creating batch parameters:', error);
    throw error;
  }
}

/**
 * Debug the entire sweep process for a network
 * @param network The network configuration (testnet or mainnet)
 * @param interfaceName The interface name to use
 */
async function debugSweepForNetwork(network: typeof TESTNET | typeof MAINNET, interfaceName: string) {
  try {
    logger.info(`======= DEBUGGING SWEEP FOR ${network === TESTNET ? 'TESTNET' : 'MAINNET'} =======`);
    logger.info('Network Configuration:', {
      MARKET_GATEWAY: network.MARKET_GATEWAY,
      MARKET_GATEWAY_MULTISEND: network.MARKET_GATEWAY_MULTISEND,
      WETH: network.WETH,
      AXIE: network.AXIE,
      RONIN_RPC: network.RONIN_RPC,
      DOMAIN_CHAIN_ID: network.DOMAIN_CHAIN_ID
    });
    
    logger.info(`Using Interface Name: ${interfaceName}`);
    
    // Create a provider for the network
    const provider = new ethers.JsonRpcProvider(network.RONIN_RPC);
    
    // Get the first wallet from the database
    const wallet = await walletService.getUserWallet(db, 1);
    if (!wallet) {
      throw new Error('No wallet found in database');
    }
    
    // Get the wallet instance
    const walletInstance = await walletService.getWalletInstance(db, wallet.id, 1);
    
    // Create a gateway contract instance
    const gatewayContract = new MarketGatewayContract(walletInstance);
    
    // Override the interface name for testing
    (gatewayContract as any).orderExchangeInterface = interfaceName;
    
    // Find some Axies to purchase
    logger.info('Finding Axies to purchase...');
    const axies = await marketplaceService.findAxiesForSale({
      collection: AxieCollection.REGULAR,
      page: 1,
      count: 2,
      sort: 'PriceAsc'
    });
    
    if (axies.results.length === 0) {
      throw new Error('No Axies found for purchase');
    }
    
    logger.info(`Found ${axies.results.length} Axies`);
    
    // Debug the first Axie's order encoding
    const axie = axies.results[0];
    logger.info('Selected Axie:', {
      id: axie.id,
      class: axie.class,
      price: axie.order?.currentPrice ? 
        ethers.formatEther(BigInt(axie.order.currentPrice)) : 'N/A'
    });
    
    // Debug order encoding
    const { order, encodedOrder } = await debugOrderEncoding(axie, gatewayContract);
    
    // Debug settlement parameters
    const orderInfo = await debugSettlementParams(
      order,
      axie.order!.signature || '0x',
      axie.order!.expectedState || '0',
      axie.order!.currentPrice,
      gatewayContract
    );
    
    // Create order exchange interface
    const orderExchangeInterface = new ethers.Interface((gatewayContract as any).ORDER_EXCHANGE_ABI);
    
    // Encode the function call for single order
    const encodedParams = orderExchangeInterface.encodeFunctionData('settleOrder', [
      orderInfo,
      BigInt(axie.order!.currentPrice),
    ]);
    
    // Debug batch parameters
    const batchParams = debugBatchParams(
      interfaceName,
      encodedParams,
      order.paymentToken,
      axie.order!.currentPrice
    );
    
    // Show the complete bulkInteractWith call parameters
    logger.info('bulkInteractWith Call Parameters:', {
      marketplaceGateway: network.MARKET_GATEWAY,
      batchParams: [batchParams],
      requiredAllSuccess: false,
      value: BigInt(0)
    });
    
    logger.info(`======= END OF DEBUG FOR ${network === TESTNET ? 'TESTNET' : 'MAINNET'} =======\n`);
  } catch (error) {
    logger.error(`Error debugging sweep for ${network === TESTNET ? 'testnet' : 'mainnet'}:`, error);
  }
}

/**
 * Compare testnet and mainnet configurations
 */
function compareConfigurations() {
  logger.info('======= COMPARING TESTNET AND MAINNET CONFIGURATIONS =======');
  
  // Compare contract addresses
  logger.info('Contract Addresses:', {
    MARKET_GATEWAY: {
      testnet: TESTNET.MARKET_GATEWAY,
      mainnet: MAINNET.MARKET_GATEWAY,
      different: TESTNET.MARKET_GATEWAY !== MAINNET.MARKET_GATEWAY
    },
    MARKET_GATEWAY_MULTISEND: {
      testnet: TESTNET.MARKET_GATEWAY_MULTISEND,
      mainnet: MAINNET.MARKET_GATEWAY_MULTISEND,
      different: TESTNET.MARKET_GATEWAY_MULTISEND !== MAINNET.MARKET_GATEWAY_MULTISEND
    },
    WETH: {
      testnet: TESTNET.WETH,
      mainnet: MAINNET.WETH,
      different: TESTNET.WETH !== MAINNET.WETH
    },
    AXIE: {
      testnet: TESTNET.AXIE,
      mainnet: MAINNET.AXIE,
      different: TESTNET.AXIE !== MAINNET.AXIE
    }
  });
  
  // Compare chain IDs
  logger.info('Chain IDs:', {
    testnet: TESTNET.DOMAIN_CHAIN_ID,
    mainnet: MAINNET.DOMAIN_CHAIN_ID,
    different: TESTNET.DOMAIN_CHAIN_ID !== MAINNET.DOMAIN_CHAIN_ID
  });
  
  logger.info('======= END OF CONFIGURATION COMPARISON =======\n');
}

/**
 * Main function to run the debug script
 */
async function main() {
  try {
    logger.info('Starting sweep debug script...');
    
    // Compare testnet and mainnet configurations
    compareConfigurations();
    
    // Test each interface name on both networks
    for (const interfaceName of INTERFACE_NAMES) {
      // Debug testnet
      await debugSweepForNetwork(TESTNET, interfaceName);
      
      // Debug mainnet
      await debugSweepForNetwork(MAINNET, interfaceName);
    }
    
    logger.info('Sweep debug script completed');
    
    // Close the database connection
    await db.destroy();
  } catch (error) {
    logger.error('Error running sweep debug script:', error);
    
    // Close the database connection
    await db.destroy();
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error);
