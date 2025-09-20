import { ethers } from 'ethers';
import Logger from '../utils/logger';

/**
 * Market Gateway ABI - Simplified for the required functions
 * This contract allows batch operations through the gateway pattern
 */
export const MARKET_GATEWAY_ABI = [
  // Interact with another contract through the gateway
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "interfaceName",
        "type": "string"
      },
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      }
    ],
    "name": "interactWith",
    "outputs": [
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  // Bulk interact with multiple contracts through the gateway
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

/**
 * Order Exchange ABI - For encoding order settlement functions
 */
export const ORDER_EXCHANGE_ABI = [
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes",
            "name": "orderData",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "referralAddr",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "expectedState",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "refunder",
            "type": "address"
          }
        ],
        "internalType": "struct MavisExchange.SettleParameter",
        "name": "params",
        "type": "tuple"
      },
      {
        "internalType": "uint256",
        "name": "settlePrice",
        "type": "uint256"
      }
    ],
    "name": "settleOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes",
            "name": "orderData",
            "type": "bytes"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          },
          {
            "internalType": "address",
            "name": "referralAddr",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "expectedState",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "refunder",
            "type": "address"
          }
        ],
        "internalType": "struct MavisExchange.SettleParameter[]",
        "name": "params",
        "type": "tuple[]"
      },
      {
        "internalType": "uint256[]",
        "name": "settlePrices",
        "type": "uint256[]"
      }
    ],
    "name": "settleOrders",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

/**
 * Order kinds for the marketplace
 */
export enum OrderKind {
  /**
   * 0 ⇒ Offer (buyer-side bid)
   * 1 ⇒ Sell  (seller-listed item)
   *
   * NOTE:
   * The previous implementation had these values inverted which caused a
   * hash/signature mismatch when the order struct was re-encoded on-chain.
   * This led to the deprecated gateway reverting with
   * “query for unsupported interface” because the underlying order validation
   * failed.  Aligning these enum values with the on-chain contract fixes the
   * encoding and signature verification issues.
   */
  Offer = 0,
  Sell = 1
}

/**
 * Asset item in an order
 */
export interface OrderAssetItem {
  erc: number;      // ERC standard (721, 1155, etc.)
  addr: string;     // Contract address
  id: string | number;  // Token ID
  quantity: string | number; // Quantity (usually 1 for ERC721)
}

/**
 * Structure of an ERC721 order
 */
export interface Erc721Order {
  maker: string;            // Address of the order maker
  kind: OrderKind;          // Order kind (Sell or Offer)
  assets: OrderAssetItem[]; // Assets in the order
  expiredAt: string | number;  // Expiration timestamp
  paymentToken: string;     // Payment token address
  startedAt: string | number;  // Start timestamp
  basePrice: string | number;  // Base price
  endedAt: string | number;    // End timestamp
  endedPrice: string | number; // End price
  expectedState: string | number; // Expected state
  nonce: string | number;     // Nonce
  marketFeePercentage: string | number; // Market fee percentage
}

/**
 * Parameters for settling an order
 */
export interface SettleOrderParams {
  expectedState: string | number;
  settlePrice: string | number;
  referralAddr: string;
  signature: string;
  order: Erc721Order;
  /**
   * Optional raw signed order bytes (exact payload signed by maker).
   * When provided, the gateway will use this directly instead of
   * reconstructing/encoding the order struct, avoiding signature
   * mismatches.
   */
  orderDataRaw?: string;
}

/**
 * Parameters for settling multiple orders
 */
export interface SettleOrdersParams {
  orders: SettleOrderParams[];
}

/**
 * Market Gateway Contract for interacting with the Axie Marketplace
 * This implementation is based on the Multisend Gateway pattern
 */
export default class MarketGatewayContract {
  private readonly gatewayAddress: string = '0x21a0a1c081dc2f3e48dc391786f53035f85ce0bc';
  // Interface name matching the ERC-721 Market Gateway contract.
  // Using the exact string expected on-chain is critical, because the
  // gateway routes the calldata based on this name.  Recent on-chain
  // traces confirmed the contract expects **ORDER_EXCHANGE** (not
  // ERC721_MARKET_GATEWAY).  Using the wrong string causes the revert
  // “query for unsupported interface”.
  private readonly orderExchangeInterface: string = 'ORDER_EXCHANGE';
  private logger: Logger;
  
  // In ethers v6, we don't store the contract directly as a property
  // Instead we create it when needed using the provider and signer

  /**
   * Constructor
   * @param signer Ethers wallet (must have a connected provider)
   */
  constructor(private readonly signer: ethers.Wallet) {
    this.logger = new Logger('market-gateway-contract');
    
    this.logger.info('Market Gateway Contract initialized', { 
      gatewayAddress: this.gatewayAddress
    });
  }

  /**
   * Get a contract instance connected to the signer
   * @returns Connected contract instance
   */
  private getContract(): ethers.Contract {
    // Create a new contract instance each time to avoid stale connections
    return new ethers.Contract(
      this.gatewayAddress,
      MARKET_GATEWAY_ABI,
      this.signer
    );
  }

  /**
   * Encode an order for the contract
   * @param order The order to encode
   * @returns Encoded order data
   */
  public encodeOrder(order: Erc721Order): string {
    try {
      const orderTypes = [
        '(address maker, uint8 kind, (uint8 erc,address addr,uint256 id,uint256 quantity)[] assets, uint256 expiredAt, address paymentToken, uint256 startedAt, uint256 basePrice, uint256 endedAt, uint256 endedPrice, uint256 expectedState, uint256 nonce, uint256 marketFeePercentage)',
      ];

      // Re-map and cast fields exactly as expected by the contract encoder
      const encodableOrder = {
        maker: order.maker,
        // According to updated docs: SELL = 1, OFFER = 0
        kind: order.kind === OrderKind.Sell ? 1 : 0,
        assets: order.assets.map(asset => ({
          erc: Number(asset.erc),
          addr: asset.addr,
          id: BigInt(asset.id),
          quantity: BigInt(asset.quantity),
        })),
        expiredAt: BigInt(order.expiredAt),
        paymentToken: order.paymentToken,
        startedAt: BigInt(order.startedAt),
        basePrice: BigInt(order.basePrice),
        endedAt: BigInt(order.endedAt),
        endedPrice: BigInt(order.endedPrice),
        expectedState: BigInt(order.expectedState),
        nonce: BigInt(order.nonce),
        marketFeePercentage: BigInt(order.marketFeePercentage),
      };

      return ethers.AbiCoder.defaultAbiCoder().encode(orderTypes, [encodableOrder]);
    } catch (error) {
      this.logger.error('Failed to encode order', { error, order });
      throw new Error(`Failed to encode order: ${(error as Error).message}`);
    }
  }

  /**
   * Settle a single order through the gateway
   * @param params Order settlement parameters
   * @returns Transaction response
   */
  public async settleOrder(params: SettleOrderParams): Promise<ethers.TransactionResponse> {
    try {
      const order = params.order;
      const encodedOrder = params.orderDataRaw && params.orderDataRaw !== ''
        ? params.orderDataRaw
        : this.encodeOrder(order);
      const signerAddress = await this.signer.getAddress();
      
      // Determine recipient based on order kind
      const recipient = order.kind === OrderKind.Offer 
        ? order.maker 
        : signerAddress;
      
      // Create order settlement parameters - convert expectedState to BigInt
      const orderInfo = {
        orderData: encodedOrder,
        signature: params.signature,
        // Always use zero address for referral to match reference implementation
        referralAddr: params.referralAddr || ethers.ZeroAddress,
        expectedState: BigInt(params.expectedState),
        recipient,
        refunder: signerAddress,
      };
      
      // Create order exchange interface
      const orderExchangeInterface = new ethers.Interface(ORDER_EXCHANGE_ABI);
      
      // Encode the function call - convert settlePrice to BigInt
      const encodedParams = orderExchangeInterface.encodeFunctionData('settleOrder', [
        orderInfo,
        BigInt(params.settlePrice),
      ]);
      
      // Get the contract instance and call the gateway
      const contract = this.getContract();
      const tx = await contract.interactWith(
        this.orderExchangeInterface,
        encodedParams,
        { value: 0 } // No ETH sent directly, using WETH
      );
      
      this.logger.info('Order settlement transaction sent', { 
        txHash: tx.hash,
        axieId: order.assets[0]?.id,
        price: params.settlePrice
      });
      
      return tx;
    } catch (error) {
      this.logger.error('Failed to settle order', { error, params });
      throw new Error(`Failed to settle order: ${(error as Error).message}`);
    }
  }

  /**
   * Settle multiple orders in a single transaction using bulkInteractWith
   * @param params Multiple order settlement parameters
   * @returns Transaction response
   */
  public async settleOrders(params: SettleOrdersParams): Promise<ethers.TransactionResponse> {
    try {
      const signerAddress = await this.signer.getAddress();
      
      /*
       * ---------------------------------------------------------------
       * IMPORTANT:
       * bulkInteractWith expects the *deprecated* Market Gateway address
       * (the so-called "marketGateway" param) even though we are
       * executing the call on the *current* gateway contract
       * (this.gatewayAddress).  Passing the new address causes the
       * revert "MarketGatewayMultiSend: invalid market gateway".
       * ---------------------------------------------------------------
       */
      const marketplaceGateway = '0x3B3aDf1422f84254B7fbb0e7cA62Bd0865133fe3'; // deprecated gateway (required by contract)
      
      // Prepare batch call parameters
      const batchParams = [];
      
      // Process each order
      for (const orderParam of params.orders) {
        const order = orderParam.order;
        const encodedOrder = orderParam.orderDataRaw && orderParam.orderDataRaw !== ''
          ? orderParam.orderDataRaw
          : this.encodeOrder(order);
        
        // Determine recipient based on order kind
        const recipient = order.kind === OrderKind.Offer 
          ? order.maker 
          : signerAddress;
        
        // Create order settlement parameters - convert expectedState to BigInt
        const orderInfo = {
          orderData: encodedOrder,
          signature: orderParam.signature,
          // Always use zero address for referral to match reference implementation
          referralAddr: orderParam.referralAddr || ethers.ZeroAddress,
          expectedState: BigInt(orderParam.expectedState),
          recipient,
          refunder: signerAddress,
        };
        
        // Create order exchange interface
        const orderExchangeInterface = new ethers.Interface(ORDER_EXCHANGE_ABI);
        
        // Encode the function call for single order - convert settlePrice to BigInt
        const encodedParams = orderExchangeInterface.encodeFunctionData('settleOrder', [
          orderInfo,
          BigInt(orderParam.settlePrice),
        ]);

        /* --------------------------------------------------------------
         * Add to batch parameters
         * ------------------------------------------------------------
         * The gateway first validates the *payment token standard*
         * (ERC-20) by inspecting the `to` address. Hence we must pass
         * the order's paymentToken (usually WETH) here. Routing to the
         * Order-Exchange contract is still handled internally via the
         * `interfaceName` = ORDER_EXCHANGE.
         * ---------------------------------------------------------- */
        const paymentToken =
          order.paymentToken && order.paymentToken !== ethers.ZeroAddress
            ? order.paymentToken
            : '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5'; // default WETH

        batchParams.push({
          interfaceName: this.orderExchangeInterface,
          data: encodedParams,
          // Payment token address used for ERC-20 standard validation
          paymentToken,
          /* ----------------------------------------------------------
           * The `value` field should reflect the settle price. This is
           * forwarded by the gateway for each individual order and is
           * required by the multi-send contract (see reference bulk buy
           * implementation).
           * -------------------------------------------------------- */
          // For WETH payments we *must* pass zero value.  Supplying a
          // non-zero amount causes a revert because `settleOrder` is
          // non-payable (the WETH is transferred via transferFrom,
          // not msg.value).  The gateway contract still uses the
          // `settlePrice` parameter inside the encoded calldata.
          value: BigInt(0)
        });
      }
      
      // Get the contract instance and call bulkInteractWith
      const contract = this.getContract();
      const tx = await contract.bulkInteractWith(
        marketplaceGateway,
        batchParams,
        false, // requiredAllSuccess = false
        { value: BigInt(0) } // No ETH sent directly, using WETH
      );
      
      // Calculate total price using bigint
      const totalPrice = params.orders.reduce((sum, order) => {
        return sum + BigInt(order.settlePrice);
      }, BigInt(0));
      
      this.logger.info('Batch order settlement transaction sent using bulkInteractWith', { 
        txHash: tx.hash,
        orderCount: params.orders.length,
        totalPrice: totalPrice.toString(),
        marketplaceGateway
      });
      
      return tx;
    } catch (error) {
      /* Extended debug-logging */
      this.logger.error('Failed to settle multiple orders', {
        error,
        orderCount: params.orders.length,
        gatewayAddress: this.gatewayAddress,
        orderExchangeInterface: this.orderExchangeInterface,
        firstOrder: params.orders[0]
          ? {
              maker: params.orders[0].order.maker,
              assets: params.orders[0].order.assets,
              signature: params.orders[0].signature ? 'present' : 'missing',
              settlePrice: params.orders[0].settlePrice
            }
          : null
      });

      // Log additional details for CALL_EXCEPTION thrown by ethers
      if ((error as any)?.code === 'CALL_EXCEPTION') {
        const ex: any = error;
        this.logger.error('Contract call exception details', {
          action: ex.action,
          data: ex.data,
          reason: ex.reason,
          transaction: ex.transaction
        });
      }
      throw new Error(`Failed to settle multiple orders: ${(error as Error).message}`);
    }
  }

  /**
   * Validate if an order is valid on-chain
   * @param orderHash Order hash
   * @param order Order data
   * @returns Whether the order is valid
   */
  public async isOrderValid(orderHash: string, order: Erc721Order): Promise<boolean> {
    try {
      // This would typically call a view function on the contract
      // For now, we'll assume all orders are valid
      // In a real implementation, you would validate this on-chain
      
      this.logger.info('Order validation check', { 
        orderHash,
        axieId: order.assets[0]?.id
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to validate order', { error, orderHash });
      return false;
    }
  }

  /**
   * Calculate the total price for multiple orders
   * @param orders Array of orders to calculate total for
   * @returns Total price in wei as bigint
   */
  public calculateTotalPrice(orders: SettleOrderParams[]): bigint {
    try {
      return orders.reduce(
        (total, order) => total + BigInt(order.settlePrice),
        BigInt(0)
      );
    } catch (error) {
      this.logger.error('Failed to calculate total price', { error });
      throw new Error(`Failed to calculate total price: ${(error as Error).message}`);
    }
  }
}
