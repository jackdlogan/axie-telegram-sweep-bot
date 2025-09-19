# WETH-Based Sweeping Guide
_Everything you need to know to bulk–buy Axies with Wrapped ETH on Ronin_

---

## 1. What Is WETH on Ronin?
* **RON vs ETH vs WETH**  
  • RON = native gas token on Ronin  
  • ETH = value reference (1 RON ≈ 1 ETH on Ronin bridges)  
  • **WETH** = ERC-20 wrapper around RON/ETH used by the Axie Marketplace smart-contracts.  
* Why wrap?  
  Smart-contracts expect an ERC-20 interface so they can pull funds from your wallet.  
* Contract addresses (mainnet)  
  • WETH: `0xe514d9deb7966c8be0ca922de8a064264ea6bcd4`  
  • Marketplace: `0x213073989821f738a7ba3520c3d31a1f9ad31bbd`

---

## 2. How the Sweep Service Uses WETH
1. Reads your **WETH balance** via `balanceOf(address)`  
2. Checks / sets **allowance** with `approve(spender, amount)` toward the marketplace contract  
3. Executes `batchSettleAuctions()` which automatically transfers WETH from your wallet in exchange for the Axies

---

## 3. End-to-End Flow

| Step | Action | On-chain? | Notes |
|------|--------|-----------|-------|
| 1 | User presses **Start Sweeping** | ❌ | Opens `/marketplace` |
| 2 | Select collection & quantity | ❌ | Bot fetches cheapest listings |
| 3 | **Preview** generated | ❌ | Shows total cost + gas estimate |
| 4 | Service queries **WETH balance & allowance** | ✅ | `balanceOf`, `allowance` |
| 5 | _If allowance  < needed_ → **approve WETH** | ✅ | Sent once per session or when higher amount needed |
| 6 | Listings split into batches (≤20 Axies) | ❌ | Gas-limit safety |
| 7 | For each batch: price verified on-chain | ✅ | Prevents sudden listing price changes |
| 8 | Call `batchSettleAuctions()` | ✅ | WETH transferred, Axies delivered |
| 9 | Transaction monitored → history stored | ❌ | Status: pending → confirmed / failed |

---

## 4. WETH Approval Mechanism
* The marketplace contract must be allowed to pull WETH.  
* Bot checks allowance every sweep:  
  ```
  allowance = WETH.allowance(user, marketplace)
  if allowance < totalCostWei → WETH.approve(marketplace, totalCostWei)
  ```
* Approval is **idempotent**: already sufficient? no extra TX.  
* Approval TX is sent with a 20 % gas-buffer to avoid underestimation.

---

## 5. Batch Processing for Efficiency
* Ronin blocks have a lower gas limit than Ethereum-mainnet.  
* Buying > 20 Axies in one call often exceeds the limit.  
* The service automatically slices your order:  
  ```typescript
  const MAX_BATCH = 20;
  for (i = 0; i < axies.length; i += MAX_BATCH) {
      buy(axies.slice(i, i+MAX_BATCH))
  }
  ```
* Each sub-transaction still re-uses the same allowance.

---

## 6. Safety Features & Price Verification
1. **On-chain price check**:  
   `contract.getCurrentPrice(axieId)` is compared to API price.  
   If mismatch → Axie skipped, no surprises.
2. **Gas estimation +20 % buffer** to reduce “out-of-gas” failures.
3. **Max-price filter** (optional) – set ceiling per Axie.
4. **Daily RON/WETH spend limit** – protects from runaway scripts.
5. **Transaction monitoring** – bot notifies when confirmed or failed.

---

## 7. Preparing Your Wallet with WETH
1. Make sure your Ronin wallet holds **RON** for gas. (~0.05 RON per TX)  
2. Get WETH:  
   * **Katana DEX** → Swap RON ↔ WETH  
   * Ronin Wallet “Swap” tab  
3. Keep some extra WETH for gas buffer; sweep preview shows exact needs.  
4. First sweep will trigger an **approval TX** – confirm it in the wallet UI.  
5. After successful approval, future sweeps draw directly from WETH balance until allowance is exhausted.

---

### Quick Checklist Before Sweeping
- [ ] Wallet imported / created in the bot  
- [ ] WETH balance ≥ _Total Cost_ displayed in preview  
- [ ] RON balance ≥ 0.05 for gas  
- [ ] Max-price set (optional)  
- [ ] Double-checked preview → Press **Confirm Sweep**

Happy sweeping!
