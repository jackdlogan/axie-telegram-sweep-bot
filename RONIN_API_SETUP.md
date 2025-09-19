# Ronin RPC API Configuration Guide

## Overview
This guide explains how to configure your Axie Marketplace Sweep Bot to use different Ronin RPC endpoints, including the official Sky Mavis gateway with API authentication.

## RPC Endpoint Options

### 1. Public RPC (Default – No API Key Required)
The bot uses a public Ronin RPC endpoint by default that doesn’t require any API key:

* **Endpoint**: `https://api.roninchain.com/rpc`
* **Configuration**: Works out-of-the-box, no setup needed  

### 2. Alternative Public RPC
Another public endpoint you can use:

* **Endpoint**: `https://ronin.drpc.org`
* **Configuration**: Set  
  `RONIN_MAINNET_RPC=https://ronin.drpc.org` in your `.env` file

### 3. Official Sky Mavis Gateway (Requires API Key)
The official Sky Mavis endpoint provides better reliability and performance:

* **Endpoint**: `https://api-gateway.skymavis.com/rpc`
* **Requirement**: `X-API-KEY` header authentication

---

## Getting a Sky Mavis API Key
> **Note**: As of Q1 2025, Sky Mavis is transitioning to a permissionless ecosystem. Consider using alternative providers like Chainstack, Alchemy or Moralis for long-term support.

1. Visit the Sky Mavis Developer Portal  
2. Sign in or create a developer account  
3. Create a new application  
4. Generate an API key for that application  
5. Copy the API key for use in your bot configuration  

---

## Configuring the API Key

### Method 1 – Using `.env` File (Recommended)
1. Open or create your `.env` file in the project root  
2. Add:

```
# Use the official Sky Mavis RPC endpoint
RONIN_MAINNET_RPC=https://api-gateway.skymavis.com/rpc
RONIN_TESTNET_RPC=https://api-gateway.skymavis.com/rpc/testnet

# Your Sky Mavis API key
RONIN_API_KEY=your-api-key-here
```

3. Replace `your-api-key-here` with your actual API key  
4. Save the file and restart the bot (`npm run dev`)  

### Method 2 – Using Shell Environment Variables

```bash
export RONIN_MAINNET_RPC="https://api-gateway.skymavis.com/rpc"
export RONIN_API_KEY="your-api-key-here"
npm run dev
```

---

## Alternative RPC Providers

| Provider | Link | Highlights |
|----------|------|------------|
| **Chainstack** | https://chainstack.com/build-better-with-ronin/ | Free tier, archive nodes on paid plans |
| **dRPC** | https://drpc.org/chainlist/ronin | Globally distributed, high uptime |
| **Moralis** | https://docs.moralis.com/supported-networks | Enterprise-grade, free tier |
| **Alchemy** (coming Feb 2025) | https://www.alchemy.com/ | Full Web3 suite, NFT API |

Example setup for Chainstack:

1. Sign up at Chainstack  
2. Create a Ronin node and copy the endpoint URL  
3. Set `RONIN_MAINNET_RPC=your-chainstack-url` in `.env`

---

## Verifying Your Configuration

1. Start the bot:

```bash
npm run dev
```

2. Look for the wallet-service log:

```
Wallet service initialized {
  "rpcEndpoint": "https://api-gateway.skymavis.com/rpc",
  "apiKeyProvided": true
}
```

3. Try creating a wallet to confirm connectivity.

---

## Troubleshooting

| Error | Possible Causes | Fix |
|-------|-----------------|-----|
| **“Unauthorized” / “Invalid API Key”** | API key wrong or missing | Check key and endpoint |
| **“Connection timeout”** | Endpoint down / network issue | Switch to public RPC or check connection |
| **“Rate limit exceeded”** | API quota hit | Upgrade plan, rotate keys, or throttle requests |

---

## Security Best Practices
1. **Never commit API keys** – keep them in `.env` (add `.env` to `.gitignore`)  
2. **Use separate keys per environment** – dev vs prod  
3. **Rotate keys** regularly and immediately if compromised  
4. **Monitor usage** and set alerts for anomalies  

---

## Configuration Priority
The bot resolves RPC settings in this order:
1. Shell environment variables (`RONIN_MAINNET_RPC`, `RONIN_API_KEY`)  
2. `.env` file values  
3. Built-in defaults (`https://api.roninchain.com/rpc`, no key)  

---

## Example Configurations

### Development (Public RPC)

```env
# .env
RONIN_MAINNET_RPC=https://api.roninchain.com/rpc
# No API key needed
```

### Production (Sky Mavis Gateway)

```env
# .env
RONIN_MAINNET_RPC=https://api-gateway.skymavis.com/rpc
RONIN_API_KEY=sk_prod_xxxxxxxxxxxxxxxxxxxxx
```

### Testing (dRPC)

```env
# .env
RONIN_MAINNET_RPC=https://ronin.drpc.org
# No API key needed
```

---

## Support
1. Check logs for detailed error messages  
2. Verify endpoint URL and API key  
3. Test with public RPC to isolate issues  
4. Consult your RPC provider’s documentation  
