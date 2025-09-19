# Axie Marketplace Sweep Bot

Automated Telegram bot that analyzes Axie Infinity Marketplace collections and performs “sweeps” (bulk purchases) on the Ronin network.  
Built with Node.js, TypeScript, Telegraf, ethers.js, and PostgreSQL/SQLite.

---

## ✨ Features

* Ronin wallet creation / import with AES-encrypted key storage  
* Real-time marketplace data via GraphQL gateway  
* Collection analytics: floor price, averages (10/50/100), depth, historical trend  
* Configurable sweeps: choose collection, quantity, max price, filters  
* Gas-optimised batch settlement of orders (single or multi-order)  
* Interactive Telegram UI with inline keyboards & confirmations  
* Multi-wallet support + consolidated balance checker  
* Transaction monitoring & history log  
* Per-user spending limits, daily caps, notification toggles  
* Comprehensive logging (winston) and error handling  
* Pluggable cache layer (Redis)  

---

## ⚙️ Prerequisites

1. **Node.js ≥ 18** (check with `node -v`)  
2. **Yarn or npm** for dependency management  
3. **PostgreSQL 13+** *or* SQLite3 (default)  
4. **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)  
5. **Ronin RPC endpoint** (public or self-hosted)  
6. Optional: **Redis 6+** for result caching  
7. Linux/macOS or WSL; Docker instructions included for production

---

## 🛠️ Installation

```bash
git clone https://github.com/your-org/axie-sweep-bot.git
cd axie-sweep-bot
cp .env.example .env        # edit values
yarn install                # or npm install
yarn migrate                # run DB migrations
yarn dev                    # hot-reload in development
```

---

## ⚙️ Configuration

All runtime settings live in `.env`.  Most important keys:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `ADMIN_USER_IDS` | Comma-separated Telegram IDs allowed as admins |
| `RONIN_MAINNET_RPC` | Mainnet RPC URL |
| `ENCRYPTION_KEY` | 32-char+ secret for private-key encryption |
| `DB_TYPE` | `postgres` or `sqlite` |
| `MAX_SWEEP_QUANTITY` | Hard cap per sweep operation |
| … | See file for full list |

Environment-specific overrides can be provided through Docker or a process manager (pm2/systemd).

---

## 🚀 Usage

### Core Commands

| Command | Description |
|---------|-------------|
| `/start` | Register & show quick actions |
| `/wallet` | Create/import/list/select wallets |
| `/sweep` | Begin sweep wizard |
| `/balance` | Show balances of all wallets |
| `/history` | Transaction history & status |
| `/settings` | User preferences (limits, notifications) |
| `/help` | Documentation & FAQs |

### Typical Sweep Flow

1. `/wallet` → “Create New” (or import)  
2. `/sweep` → Select collection → Choose quantity (e.g. 10)  
3. Set max price or skip → Review preview (cost + gas)  
4. ✅ Confirm → Bot broadcasts transaction → Wait for confirmation  
5. `/history` to inspect details or get explorer link.

---

## 🏗️ Deployment (Production)

### Docker Compose

```yaml
version: "3.9"
services:
  bot:
    build: .
    env_file: .env
    restart: unless-stopped
    depends_on: [db]
  db:
    image: postgres:15
    environment:
      POSTGRES_USER: axie_bot_user
      POSTGRES_PASSWORD: strong_pw
      POSTGRES_DB: axie_bot_db
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    restart: unless-stopped
  redis:
    image: redis:6
    command: ["redis-server", "--appendonly", "yes"]
    restart: unless-stopped
```

```bash
docker compose up -d --build
```

*For SQLite deployments remove the `db` service and set `DB_TYPE=sqlite`.*

### Systemd (alternative)

1. `yarn build`  
2. Copy `dist/` & `node_modules` to server  
3. Create a systemd unit pointing to `node dist/index.js` with `EnvironmentFile=/etc/axie-bot.env`  

---

## 🔒 Security Considerations

* Private keys are **AES-256-CBC** encrypted with `ENCRYPTION_KEY`.  
* Keys are decrypted only in memory for signing; never logged.  
* Messages containing keys are deleted immediately after processing.  
* Daily and per-tx RON limits mitigate accidental overspend.  
* Fail-closed error handling: if price, gas, or balance checks fail, sweep aborts.  
* Use separate hot wallets; keep cold storage offline.

---

## 🩹 Troubleshooting

| Symptom | Possible Cause | Fix |
|---------|----------------|-----|
| “Invalid private key” | Missing `0x` or wrong length | Re-paste key with correct format |
| “Insufficient balance” | Not enough RON incl. gas | Send more RON or lower quantity |
| Transaction stuck “⏳ pending” | Network congestion | Wait or bump gas price strategy |
| “Failed to fetch collection stats” | Axie API downtime | Retry; backup endpoint auto-fails-over |
| Bot silent / no replies | Bot crashed or blocked by Telegram | Check logs (`logs/axie-bot.log`) & restart |

---

## 📚 API Reference

### GraphQL Endpoint

`POST https://graphql-gateway.axieinfinity.com/graphql`

Example query: see `services/marketplaceService.ts`.

### Key Smart-Contract Addresses (Ronin Mainnet)

| Contract | Address |
|----------|---------|
| Axie ERC-721 | `0x32950d...` |
| Marketplace | `0x213073...` |
| RON Token | `0xe514d9...` |

ABI snippets included in source for settlement & ERC-20 interactions.

---

## 🤝 Contributing

1. Fork the repo & create a branch: `git checkout -b feat/my-feature`  
2. Run `yarn lint && yarn test` before commits  
3. Open a PR describing changes; follow Conventional Commits  
4. Maintainers will review & merge after CI passes

All contributions must follow the project’s Code of Conduct (see `CODE_OF_CONDUCT.md`).

---

## 📝 License

MIT © 2025 San Francisco AI Factory  
See `LICENSE` file for details.

