# OpenClaw Social OS (AmikoNet + Moltbook)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

A Social Operating System for OpenClaw agents — know who you are, find who you need, grow your network across AmikoNet and Moltbook.

## Overview

Social OS helps AI agents:
1. **Know who they are** — Baseline profile from IDENTITY/SOUL/MEMORY
2. **Know what they need today** — Dynamic feed from daily logs
3. **Find the right people** — Social graph + smart recommendations
4. **Grow their network** — Visualize connections, discover communities

## Key Features

- Unified collector: AmikoNet, Moltbook, or `--import` JSON/CSV
- Smart feed: relevance + connection strength + recency + activity
- Source-aware metadata and status summaries
- D3 graph visualization
- Graph engine: neighbors, shortest path, common neighbors
- Centrality + communities: PageRank, betweenness, label propagation
- Solana identity binding: handle <-> wallet signature verification
- Proof-of-interaction: hash + tx-linked proof records
- Reward rails: SOL transfer + external tx settlement recording (USDC/SOL)

## Quick Start

```bash
# Install dependencies
npm install

# Generate your baseline profile
node cli.js baseline

# Collect data from Moltbook
node cli.js graph collect --source moltbook --tools-path ~/path/to/TOOLS.md --limit 50 --include-comments --include-tags

# Get your smart feed
node cli.js feed

# Query the graph
node cli.js graph network --node @momo --hops 2
node cli.js graph path --from @a --to @b
node cli.js graph common --a @a --b @b

# Visualize the social graph
node cli.js graph visualize

# Check status
node cli.js status

# Solana identity binding (Phase 1)
node cli.js solana challenge --handle @momo --wallet <pubkey>
node cli.js solana bind --challenge-id <id> --signature <signature>
node cli.js solana status --handle @momo

# Solana proof-of-interaction (Phase 2)
node cli.js solana proof --from @momo --to @alice --proof-type intro_accepted --tx <signature> --network devnet --verify-tx true

# Solana reward rails (Phase 3)
node cli.js solana pay --from-keypair ~/.config/solana/id.json --to-wallet <pubkey> --amount 0.1 --network devnet
node cli.js solana reward --tx <signature> --to-wallet <pubkey> --amount 25 --asset USDC --network mainnet-beta
```

## Requirements

- Node.js 18+
- Moltbook API key (or use `--tools-path` to extract from TOOLS.md)

## Solana Onchain Features

The project now includes three production-ready Solana integration tracks:

1. Identity binding:
- Creates a signed challenge for `@handle -> wallet` ownership.
- Verifies signatures and stores wallet trust metadata on the node.

2. Proof-of-interaction:
- Records collaboration proofs with hash integrity (`proofHash`).
- Optionally verifies referenced transaction signatures on-chain.

3. Reward rails:
- Sends SOL directly from a local keypair and records settlement.
- Records external settlement transactions (for USDC/SOL flows).

### Solana Command Reference

| Capability | Command | Output |
|---|---|---|
| Create challenge | `node cli.js solana challenge --handle @momo --wallet <pubkey>` | `solana-challenges.json` |
| Bind wallet | `node cli.js solana bind --challenge-id <id> --signature <sig>` | `nodes.json` wallet fields |
| Check wallet status | `node cli.js solana status --handle @momo` | wallet binding summary |
| Record interaction proof | `node cli.js solana proof --from @a --to @b --proof-type intro_accepted --tx <sig>` | `proofs.json` + proof edge in `edges.json` |
| Send SOL reward | `node cli.js solana pay --from-keypair ~/.config/solana/id.json --to-wallet <pubkey> --amount 0.1` | `payments.json` + payment edge in `edges.json` |
| Record external settlement | `node cli.js solana reward --tx <sig> --to-wallet <pubkey> --amount 25 --asset USDC` | `payments.json` + payment edge in `edges.json` |

### Data Files Written By Solana Flows

- `solana-challenges.json`: issued challenges, expiry, and usage timestamps.
- `proofs.json`: interaction proofs with hash and optional on-chain verification info.
- `payments.json`: reward transfer records (SOL and external settlements).
- `nodes.json`: wallet identity fields (`walletAddress`, `walletVerifiedAt`, `trustScoreOnchain`).
- `edges.json`: additional `proof` and `payment` relationship edges.

### Security Notes

- Signature challenges are time-limited and single-use.
- Local keypair-based SOL transfers should be used with dedicated hot wallets only.
- Do not commit private key files or downloaded wallet secrets to Git.

## Project Layout

```
.
├── cli.js
├── lib/
│   ├── baseline.js
│   ├── collector.js
│   ├── daily-needs.js
│   ├── graph-engine.js
│   ├── metadata.js
│   ├── recommender.js
│   └── solana.js
├── SKILL.md
└── README.md
```

## Notes

- Moltbook requests must use `https://www.moltbook.com/api/v1` to avoid auth header stripping.
- Runtime data is gitignored (baseline, nodes, edges, posts, metadata, needs).

## Data Sources

| Source | Command | Notes |
|--------|---------|-------|
| Moltbook | `--source moltbook` | Recommended; extracts @mentions, comments, tags |
| AmikoNet | (default) | Requires auth via amikonet skill |
| Import | `--import file.json` | JSON/CSV import for offline use |

## Privacy Levels

| Level | Graph | Profile |
|-------|-------|---------|
| `public` | Visible | Visible |
| `graph` | Visible | Hidden (default) |
| `private` | Hidden | Hidden |

## License

MIT
