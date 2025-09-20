# Axie Telegram Sweep Bot

Telegram bot for bulk‐buying (“sweeping”) Axies on the Ronin network.  
Built with **Node.js 18+, TypeScript, Telegraf, ethers v6** and **SQLite** by default (PostgreSQL optional).

---

## ✨ Features

- Atomic sweep of listings with automatic batching (single TX requiresAllSuccess = true)
- `/transfer` command for Axie batch transfers (IDs returned on separate line)
- Google Sheets audit logging  
  - Tabs: **Sweep**, **Transfer**  
  - Auto-create headers; newline-separated `axieIds`
- Safer transaction monitoring – `waitForTransaction` with configurable retries
- UI improvements: HTML parse mode, consistent tx-hash display, session guard to prevent double-clicks
- History retention (latest 30 records per user)
- Daily spend limits & per-transaction caps
- Optional Redis cache layer for marketplace queries
- Detailed logging (Winston) with file/console targets

---

## 🛠️ Prerequisites

1. Node ≥ 18 and npm
2. SQLite 3 (default) ‑or- PostgreSQL 13+
3. Telegram bot token from [@BotFather](https://t.me/BotFather)
4. Ronin RPC endpoint (public or Sky Mavis). See [RONIN_API_SETUP.md](RONIN_API_SETUP.md).
5. (Optional) Redis 6 for caching
6. (Optional) Google Service Account for Sheets logging

---

## 🚀 Quick Start

```bash
git clone https://github.com/jackdlogan/axie-telegram-sweep-bot.git
cd axie-telegram-sweep-bot

npm ci                              # install deps (frozen lockfile)

cp .env.example .env                # if file absent, create and fill vars below
# edit .env with your details

npm run build                       # compile TypeScript
npm run migrate                     # run DB migrations
npm run dev                         # start bot in watch mode
```

---

## 🔑 Environment Variables

| Key | Required | Default / Example | Description |
|-----|----------|-------------------|-------------|
| TELEGRAM_BOT_TOKEN | ✅ | – | Bot token from BotFather |
| ENCRYPTION_KEY | ✅ | – | ≥32 chars AES key for wallet encryption |
| ADMIN_USER_IDS |  | `12345678,98765432` | Comma-separated Telegram IDs |
| RONIN_MAINNET_RPC |  | `https://api.roninchain.com/rpc` | Mainnet RPC URL |
| RONIN_API_KEY |  | – | Required when using Sky Mavis gateway |
| AXIE_GRAPHQL_API |  | `https://graphql-gateway.axieinfinity.com/graphql` | Marketplace GraphQL endpoint |
| AXIE_GRAPHQL_API_KEY |  | – | API-Gateway key if needed |
| DB_TYPE |  | `sqlite` | `sqlite` or `postgres` |
| SQLITE_FILENAME |  | `./data/axie_bot.sqlite` | SQLite DB file |
| POSTGRES_HOST |  | `localhost` | Postgres settings (if DB_TYPE=postgres) |
| POSTGRES_PORT |  | `5432` |  |
| POSTGRES_USER |  | `axie_bot_user` |  |
| POSTGRES_PASSWORD |  | `password` |  |
| POSTGRES_DB |  | `axie_bot_db` |  |
| GOOGLE_SA_EMAIL |  | – | Service Account email for Sheets |
| GOOGLE_SA_PRIVATE_KEY |  | – | `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` (escape newlines as `\\n` in `.env`) |
| GOOGLE_SHEETS_SPREADSHEET_ID |  | – | Target spreadsheet ID |
| LOG_LEVEL |  | `info` | error / warn / info / debug |
| LOG_TO_FILE |  | `true` | Persist logs to file |
| LOG_FILE_PATH |  | `./logs/axie-bot.log` | Log file location |
| MAX_TRANSACTION_AMOUNT |  | `10` | Max WETH per sweep (Ξ) |
| MAX_DAILY_TRANSACTION_AMOUNT |  | `50` | Daily cap (Ξ) |
| MAX_SWEEP_QUANTITY |  | `100` | Axies per sweep |

_A minimal `.env` requires only **TELEGRAM_BOT_TOKEN** and **ENCRYPTION_KEY** – the rest have sensible defaults._

---

## 📊 Google Sheets Integration

1. Create a **Service Account** in Google Cloud → enable **Google Sheets API**.  
2. Generate a JSON key; copy **client_email** and **private_key** into `.env` (`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`).  
   - Replace real newlines in the key with `\n` when pasting into `.env`.  
3. Create a spreadsheet and share it with the Service Account email.  
4. Set `GOOGLE_SHEETS_SPREADSHEET_ID` in `.env`.  

The bot auto-creates / updates headers:  
`timestamp, collection, quantity, axieIds, txHash, wallet, totalAmount, gasUsed, status` in tabs **Sweep** and **Transfer**.

---

## 🤖 Bot Commands

| Command | Purpose |
|---------|---------|
| `/start` | Home menu with Google Sheet link & actions |
| `/sweep` | Start bulk-buy wizard |
| `/transfer` | Batch transfer Axies (IDs echoed back on success) |
| `/history` | Show last 30 transactions (status, txHash) |
| `/settings` | View/change daily limits, gas strategy |

---

## 🧑‍💻 Development Scripts

| Script | Action |
|--------|--------|
| `npm run dev` | Start bot with ts-node-dev auto reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run migrate` | Run latest DB migrations |
| `npm run migrate:rollback` | Rollback last migration |
| `npm run test` | Jest test suite (if tests present) |
| `npm run lint` | ESLint code linting |

---

## 📦 Deployment

Docker & docker-compose are included:

```bash
docker compose up -d --build   # uses SQLite by default
```

Edit `docker-compose.yml` to switch to Postgres.  
Keep **ENCRYPTION_KEY** secret and ≥32 characters.

Contract addresses (Ronin mainnet):

| Contract | Address |
|----------|----------------------------------------------|
| Marketplace | `0x213073989821f738a7ba3520c3d31a1f9ad31bbd` |
| WETH | `0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5` |
| Axie ERC-721 | `0x32950db2a7164ae833121501c797d79e7b79d74c` |

---

## 🩹 Troubleshooting

| Issue | Hint |
|-------|------|
| Telegram “parse_mode” errors | Bot now uses HTML mode – ensure tags are balanced |
| False failure after sweep | Fixed by safe `waitForTransaction` monitor |
| `SQLITE_ERROR: no such column` | Run `npm run migrate` |
| Google Sheets “unauthorized” | Share spreadsheet with Service Account email |
| Sky Mavis RPC 401 | Provide `RONIN_API_KEY` or switch to public RPC |

---

## 📝 License

MIT © 2025 San Francisco AI Factory
