# Reflect Keeper

Off-chain keeper service for depositing USDC into yield-bearing protocols on Solana.

**Active yield backend: [Jupiter Lend](https://jup.ag/lend)** — deposits USDC and receives jlUSDC, an exchange-rate-appreciating share token (~8% APY).

**Also integrated (mainnet, pending devnet USDC faucet): [Reflect](https://docs.reflect.money)** — USDC+ stablecoin backed by Drift, Jupiter, and Kamino lending markets.

---

## Step-by-step setup

### Prerequisites

- **Node.js 20+** — `node --version` should print `v20.x.x` or higher
- **Yarn** — `yarn --version` should print 1.x or 4.x
- **Solana CLI** — `solana --version`. Install: `sh -c "$(curl -sSfL https://release.anza.xyz/v2.1.21/install)"`
- **PM2** (for production) — `npm install -g pm2`
- A Solana keypair file. If you already have `~/.config/solana/id.json` from earlier work, that's fine. Otherwise: `solana-keygen new`

### Step 1 — Install dependencies

```bash
cd reflect-keeper
yarn install
```

### Step 2 — Create the keeper wallet

#### Option A — Solo keypair (dev / staging)

Reuse your existing Solana CLI keypair:

```bash
cp ~/.config/solana/id.json keeper-keypair.json
```

Or generate a fresh dedicated key:

```bash
solana-keygen new --no-bip39-passphrase -o keeper-keypair.json
```

The file is gitignored. Note the public key — you will need it in the next step.

#### Option B — Squads multisig (production)

For production the keeper's funds should live in a [Squads](https://squads.so) multisig vault rather than a bare keypair, so that no single key can move funds unilaterally.

1. Generate the hot-signer keypair that the keeper process will use to sign transactions:

   ```bash
   solana-keygen new --no-bip39-passphrase -o keeper-keypair.json
   ```

2. Create the Squads multisig, passing the hot-signer public key as the member:

   ```bash
   yarn squads:create <hot-signer-pubkey>
   ```

   Expected output:

   ```
   Squads multisig created
     multisigPda : <multisig-pda>
     vaultPda    : <vault-pda>
     signature   : <tx-signature>
     url         : https://app.squads.so/squads/<multisig-pda>/treasury/<vault-pda>
   ```

3. Open the Squads URL (may take up to 15 minutes for the indexer to surface the account).

4. Fund the **vault** address (`vaultPda`) with SOL and USDC — not the hot-signer key.

The hot-signer keypair signs transactions on behalf of the vault. The vault holds all funds; the hot-signer holds only enough SOL for fees.

### Step 3 — Configure environment

```bash
cp .env.example .env
```

Then edit `.env`. The table below explains every variable:

#### Solana cluster

Flip clusters with a **single variable** — `RPC_URL` is derived automatically from `CLUSTER` unless you set it explicitly.

```
CLUSTER=devnet           # or mainnet-beta
# RPC_URL=               # optional override (Helius, Triton, etc.)
```

| `CLUSTER` value | Default RPC | Explorer URLs auto-append |
|-----------------|-------------|--------------------------|
| `devnet`        | `https://api.devnet.solana.com` | `?cluster=devnet` |
| `mainnet-beta`  | `https://api.mainnet-beta.solana.com` | (no suffix needed) |

Confirm what's loaded:

```bash
yarn cluster
```

Output:

```
Cluster : mainnet-beta
RPC URL : https://api.mainnet-beta.solana.com
Keeper  : /…/keeper-keypair.json
Redis   : redis://default:<redacted>@…
```

Some operations are cluster-guarded automatically:
- `yarn wallet:airdrop` — refuses to run on `mainnet-beta`
- Logged explorer URLs include the right cluster suffix on devnet

#### Keeper wallet

```
KEEPER_KEYPAIR_PATH=./keeper-keypair.json
```

Point this at the JSON keypair generated in Step 2.

#### Redis — savings schedule database

The keeper stores per-user savings configs in any Redis instance. Set a single connection URL:

```
REDIS_URL=rediss://default:<token>@<host>.upstash.io:6379
```

| Provider | Where to get the URL |
|----------|----------------------|
| **Upstash** | Console → your database → **Connect** tab → copy the `rediss://…` connection string |
| **Vercel KV** | Dashboard → Storage → your KV → `.env.local` tab — copy `KV_URL` |
| **Local** | `redis://localhost:6379` |

#### Scheduler poll interval

```
SCHEDULER_POLL_INTERVAL_MS=60000   # default: 1 minute
```

How often the keeper polls Redis for due configs. 60 s is fine for production. Set to `10000` during development if you want faster feedback.

### Step 4 — Verify the wallet loads

```bash
yarn wallet:show
```

Expected output:

```
Address : <your-keeper-pubkey>
Balance : 0.0000 SOL
```

### Step 5 — Fund the keeper

You need:

1. **SOL** for transaction fees (~0.05 SOL is enough)
2. **USDC** to deposit

**On devnet** — SOL via airdrop:

```bash
yarn wallet:airdrop
```

If rate-limited, use https://faucet.solana.com.

**On mainnet** — send SOL and USDC to your keeper address from any exchange or wallet (Coinbase, Phantom, etc.). Even 0.1 USDC is enough to test.

Confirm what you have:

```bash
yarn balance
```

Expected output:

```
Wallet : <your-keeper-pubkey>
SOL    : 0.0650

Token balances:
  USDC      : 2.508660  (raw: 2508660)
  jlUSDC    : ATA not yet initialized

Jupiter Lend position:
  No position found
```

---

## Running the scheduler

The keeper runs as a **long-lived process** that polls Redis every `SCHEDULER_POLL_INTERVAL_MS` milliseconds. On each tick it fetches all savings configs whose `nextRunAt ≤ now`, executes their Jupiter Lend deposits, and advances `nextRunAt` by `intervalSeconds`.

### Development (no build)

```bash
yarn dev
```

Uses `tsx watch` — restarts on file changes.

### Production with PM2

```bash
# 1. Compile TypeScript
yarn build

# 2. Start under PM2 (reads ecosystem.config.cjs)
yarn pm2:start

# Tail logs
yarn pm2:logs

# Check status
yarn pm2:status

# Stop
yarn pm2:stop
```

PM2 will restart the process automatically if it crashes. The config file is [`ecosystem.config.cjs`](ecosystem.config.cjs).

**Make PM2 survive reboots:**

```bash
pm2 startup          # prints a system-specific command — run it
pm2 save             # saves the current process list
```

### One-shot run (no long-lived process)

If you just want to run all due configs once and exit (useful for testing or an external cron job):

```bash
yarn run:schedules
```

Exits with code `0` if all succeeded, `1` if any deposit failed.

---

## Savings configs (Redis schema)

Users are keyed by Telegram ID. Each user has up to five keys:

| Key | Type | Purpose |
|-----|------|---------|
| `settings:telegram:<id>` | string (JSON) | Active savings + funding config |
| `settings:pending:telegram:<id>` | string (JSON) | Draft settings before user confirms |
| `wallet:telegram:<id>` | string (JSON) | User's Privy wallet address + ID |
| `airdrop_sent:telegram:<id>` | string | Marker that a one-time airdrop has been sent |
| `savings:tx:telegram:<id>` | list (JSON items) | Per-user transaction history, newest first |

### `settings:telegram:<id>`

```json
{
  "savingsFrequency": "weekly",
  "savingsAmountUsd": 250,
  "savingsStrategy": "reflect",
  "delegationTxSignature": "gmA8...",
  "delegationSetAt": "2026-05-10T16:47:41.278Z",
  "fundingFrequency": "weekly",
  "fundingAmountUsd": 250,
  "fundingConfiguredAt": "2026-05-10T16:47:42.559Z",
  "lastRunAt": "2026-05-17T16:47:42.559Z"
}
```

| Field | Description |
|-------|-------------|
| `savingsAmountUsd` / `fundingAmountUsd` | USD value (assumed pegged to USDC 1:1) |
| `savingsFrequency` / `fundingFrequency` | `"daily"` \| `"weekly"` \| `"monthly"` |
| `savingsStrategy` | `"jupiter"` (active) or `"reflect"` (integrated, not active) |
| `delegationTxSignature` | SPL Approve tx granting the keeper delegate rights on the user's USDC ATA |
| `fundingConfiguredAt` | ISO timestamp — start point for scheduling if `lastRunAt` is absent |
| `lastRunAt` | ISO timestamp written by the keeper after each successful deposit |

### `wallet:telegram:<id>`

```json
{
  "walletType": "privy",
  "walletId": "mers606a9hnqfvjrs09p1f5v",
  "walletAddress": "5LXoEAWsVbq7TznzvjYaNVSTpsWj9QtDau4ntViX8fh5",
  "vaultAddress": "4ae7uhubGdLrBC6vyXq81SJ536Qeuj9ZSkFyestdBQir",
  "privyUserId": "did:privy:cmoi57ii300nm0cle19fa39zz"
}
```

| Field | Description |
|-------|-------------|
| `walletAddress` | The Privy-managed **signer** wallet — the user's transaction-signing identity |
| `vaultAddress` | The **Squads multisig vault** — destination for yield tokens. Optional. |

**Deposit recipient resolution:** the keeper transfers yield tokens to `vaultAddress` if set; otherwise it falls back to `walletAddress`. This is so a user who hasn't yet provisioned a Squads vault still receives their jlUSDC.

### `savings:tx:telegram:<id>` — transaction history

Redis **list** (LPUSH newest-first). Each entry is a JSON-encoded record:

```json
{
  "depositSignature": "3JDfHF...",
  "transferSignature": "5Mb91x...",
  "timestamp": "2026-05-17T16:47:42.559Z",
  "recipientAddress": "4ae7uhubGdLrBC6vyXq81SJ536Qeuj9ZSkFyestdBQir",
  "signerWallet": "5LXoEAWsVbq7TznzvjYaNVSTpsWj9QtDau4ntViX8fh5",
  "amountUsd": 250,
  "amountUsdcRaw": "250000000",
  "jlUsdcReceived": "239881234",
  "platform": "jupiter",
  "status": "success"
}
```

| Field | Description |
|-------|-------------|
| `depositSignature` | Tx hash for USDC → Jupiter Lend |
| `transferSignature` | Tx hash for jlUSDC → recipient. Omitted on `partial` status |
| `timestamp` | ISO time the keeper recorded the entry |
| `recipientAddress` | Where the yield tokens went — Squads vault if set, else Privy signer |
| `signerWallet` | Privy signer wallet for the user (cross-reference with `wallet:telegram:<id>`) |
| `amountUsdcRaw` | Raw USDC units deposited (6 decimals) |
| `jlUsdcReceived` | Raw jlUSDC shares minted on this deposit |
| `status` | `"success"` (full flow) or `"partial"` (deposit ok, transfer failed) |
| `error` | Only present on `"partial"` — the transfer-leg error message |

Query the latest history with `LRANGE savings:tx:telegram:<id> 0 49` for the most recent 50, or `0 -1` for the entire log.

### How the scheduler picks users

On each tick the keeper:

1. Calls `KEYS wallet:telegram:*` to enumerate every user in the system.
2. Skips users without a committed `settings:telegram:<id>` document.
3. Skips users missing `fundingConfiguredAt` or `fundingAmountUsd`.
4. Computes `nextDueAt`:
   - **First run** (no `lastRunAt`): due immediately at `fundingConfiguredAt` — the very next tick after the user configures their savings will execute a deposit.
   - **Subsequent runs**: due `fundingFrequency` after the previous `lastRunAt`.
5. If `now ≥ nextDueAt`, **deposits USDC** into Jupiter Lend from the keeper wallet (receives jlUSDC).
6. **Transfers** the freshly minted jlUSDC to the recipient (Squads vault if set, else Privy signer; PDAs are supported via `allowOwnerOffCurve=true`).
7. Writes `lastRunAt = now` back into `settings:telegram:<id>`.

The `delegationTxSignature` is read but not yet acted on — Phase 1 funds the deposit from the keeper's USDC. Phase 2 will use the SPL delegate to pull from each user's ATA.

#### Result statuses

| Status | Meaning |
|--------|---------|
| `success` | Deposit + transfer both confirmed |
| `partial` | Deposit confirmed, transfer failed — jlUSDC sits in keeper wallet, manual recovery needed. `lastRunAt` is still advanced so the next tick does not double-deposit. |
| `failed` | Deposit itself failed; `lastRunAt` NOT advanced — will retry on next tick |
| `skipped` | Not due, no funding configured, no wallet, or invalid wallet address |

---

## Jupiter Lend

### Manual deposit

```bash
# Deposit 0.1 USDC into Jupiter Lend
yarn jupiter:deposit 0.1

# Deposit 1 USDC
yarn jupiter:deposit 1
```

Expected output:

```
[12:34:07] INFO: Building Jupiter Lend deposit instructions
    amountUsdc: "100000"
    keeper: "<your-pubkey>"
[12:34:08] INFO: Sending transaction
[12:34:09] INFO: Deposit confirmed
    signature: "3JDfHF..."
    explorer: "https://explorer.solana.com/tx/3JDfHF..."
[12:34:09] INFO: Jupiter Lend deposit complete
```

### Verify position

```bash
yarn balance
```

```
Token balances:
  USDC      : 2.408660  (raw: 2408660)
  jlUSDC    : 0.095955  (raw: 95955)

Jupiter Lend position:
  jlUSDC    : 0.095955 shares (~0.099999 USDC)
```

You deposited 0.1 USDC and received ~0.096 jlUSDC. The difference is the exchange rate (~1.042) — the pool has already accrued yield since launch. Your share count is fixed; its USDC redemption value grows over time.

### How yield works (jlUSDC)

jlUSDC is an **exchange-rate-appreciating** share token, not a rebasing token:

1. You deposit 0.1 USDC at exchange rate 1.042 → receive 0.096 jlUSDC
2. Your jlUSDC balance stays at **0.096 forever**
3. Jupiter Lend earns yield from lending borrowers, which raises the exchange rate
4. After a year at ~8% APY, rate ≈ 1.126 → your 0.096 jlUSDC redeems for ~0.108 USDC

`yarn balance` shows both shares and current USDC value by querying the on-chain exchange rate.

---

## Reflect (USDC+)

> **Status:** Code is complete and tested on mainnet architecture. Devnet testing is blocked on Reflect's devnet USDC faucet (`8zGuJQqwhZafTah7Uc7Z4tXRnguqkn5KLFAP8oV6PHe2` — contact Reflect team or their Discord).

### Deposit

```bash
# Deposit 0.1 USDC with 1% max slippage (default)
yarn deposit 0.1

# Specify slippage in basis points (50 = 0.5%)
yarn deposit 0.1 50
```

Expected output:

```
[12:34:56] INFO: Reflect SDK loaded
[12:34:57] INFO: Building Reflect mint instruction
[12:34:57] INFO: Sending transaction
    signature: "3aBcDe...XyZ"
[12:34:59] INFO: Deposit confirmed
[12:35:00] INFO: Deposit complete
    explorer: "https://explorer.solana.com/tx/3aBcDe...XyZ"
```

### How yield works (USDC+)

Same exchange-rate mechanic as jlUSDC. USDC+ is backed by Reflect's strategy across Drift, Jupiter Earn, and Kamino simultaneously, so the exchange rate grows as all three earn yield.

---

## Project layout

```
reflect-keeper/
├── src/
│   ├── config.ts              — env loading, validation
│   ├── connection.ts          — two RPC clients (web3.js + @solana/kit)
│   ├── wallet.ts              — keypair → two signer types (web3.js + kit)
│   ├── logger.ts              — pino structured logger
│   ├── db.ts                  — Upstash Redis CRUD + savings:schedule sorted set
│   ├── scheduler.ts           — fetch due configs, run deposits, advance nextRunAt
│   ├── jupiter-lend.ts        — Jupiter Lend deposit + position query (active)
│   ├── reflect.ts             — Reflect SDK deposit logic (integrated, not active)
│   ├── squads.ts              — Squads v4 multisig creation
│   ├── index.ts               — long-running scheduler entry point (used by PM2)
│   └── cli/
│       ├── run-schedules.ts   — `yarn run:schedules` (one-shot)
│       ├── jupiter-deposit.ts — `yarn jupiter:deposit <amount>`
│       ├── deposit.ts         — `yarn deposit <amount>` (Reflect)
│       ├── squads-create.ts   — `yarn squads:create <address>`
│       ├── balance.ts         — `yarn balance`
│       ├── wallet.ts          — `yarn wallet:show`
│       └── airdrop.ts         — `yarn wallet:airdrop`
├── ecosystem.config.cjs       — PM2 process config
├── .env.example
├── package.json
└── tsconfig.json
```

### Why two SDKs?

Jupiter Lend uses `@solana/web3.js` (v1, legacy). Reflect uses `@solana/kit` (v2, newer). They are incompatible at the signer and RPC type level. `connection.ts` and `wallet.ts` each export two objects — one per SDK — backed by the same key and the same RPC URL.

---

## What's next (roadmap)

1. ✅ Keeper deposits its own USDC — Jupiter Lend (done)
2. ✅ Keeper deposits its own USDC — Reflect USDC+ (integrated)
3. ✅ Per-user savings configs in Redis
4. ✅ Scheduler loop + PM2 process management
5. ⬜ User SPL `Approve` → keeper as delegate on user's USDC ATA
6. ⬜ Cron loop: pull user's USDC via delegate, deposit, credit yield token to user's ATA
7. ⬜ On-chain registry contract recording each deposit for audit
8. ⬜ Production hardening: keeper key in Squads multisig, monitoring, alerting, retry logic

---

## Operational notes

**Mainnet readiness checklist:**
- [ ] Keeper keypair in Squads multisig or HSM
- [ ] Per-user allowance caps in code, not just SPL delegate
- [ ] Monitoring on keeper SOL balance (alert if < 0.1 SOL)
- [ ] Monitoring on every failed deposit
- [ ] Transaction logs persisted (signature, timestamp, user, amount) — required for audit
- [ ] Retry policy: retry transient RPC failures, do NOT retry protocol errors (insufficient funds, paused pool)

**Common failure modes:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Insufficient funds` | Keeper out of SOL or USDC | Top up |
| `Blockhash not found` | RPC timeout | Retry; idempotent |
| `Slippage protection triggered` (Reflect) | Exchange rate moved mid-tx | Increase `slippageBps` |
| `This action is suspended` (Reflect) | Reflect paused deposits via killswitch | Wait; alert team |
| `fTokenDepositInsignificant` (Jupiter) | Amount too small after fee | Deposit a larger amount |

---

## References

**Jupiter Lend**
- SDK: https://www.npmjs.com/package/@jup-ag/lend
- Docs: https://dev.jup.ag/docs/lend
- Program: `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9`
- USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- jlUSDC mint: `9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D`

**Reflect**
- SDK: https://www.npmjs.com/package/@reflectmoney/stable.ts
- Docs: https://docs.reflect.money
- Program (devnet + mainnet): `rFLctqnUuxLmYsW5r9zNujfJx9hGpnP1csXr9PYwVgX`
- USDC+ mint: `usd63SVWcKqLeyNHpmVhZGYAqfE5RHE8jwqjRA2ida2`
- USDC+ controller: `579cFgopyAezPgYzTyjYa8Gwphfw4YZ1cJADrMLHEPG5`
- Devnet USDC mint: `8zGuJQqwhZafTah7Uc7Z4tXRnguqkn5KLFAP8oV6PHe2`
- Reflect's lookup table: `AV6pY5EDZVXeZT97MLeGxPyqMtjDpTNcwM4dNmWp9UE`

**Redis**
- ioredis SDK: https://www.npmjs.com/package/ioredis
- Upstash console: https://console.upstash.com
