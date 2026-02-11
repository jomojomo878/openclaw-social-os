/**
 * OpenClaw Social OS MCP Skill
 * Exposes baseline, feed, collection, visualization, and graph queries as tools.
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLAWD_PATH = path.join(os.homedir(), 'clawd-work');
const DEFAULT_SOCIAL_PATH = path.join(DEFAULT_CLAWD_PATH, 'social');

async function loadLib(name) {
  const modulePath = path.join(__dirname, 'lib', `${name}.js`);
  return (await import(`file://${modulePath}`));
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    execFile('node', [path.join(__dirname, 'cli.js'), ...args], (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout, stderr });
    });
  });
}

export default {
  name: 'social',
  description: 'OpenClaw Social OS (AmikoNet + Moltbook) - baseline, feed, graph collection, and visualization',

  tools: {
    social_generate_baseline: {
      description: 'Generate baseline profile from IDENTITY/SOUL/MEMORY',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          handle: { type: 'string' },
          did: { type: 'string' },
          memory_days: { type: 'number' },
          clawd_path: { type: 'string' },
          social_path: { type: 'string' }
        }
      },
      async execute(args) {
        const { generateBaseline, saveBaseline } = await loadLib('baseline');
        const profile = await generateBaseline({
          agentDid: args.did,
          agentName: args.name || 'Jojo',
          amikonetHandle: args.handle || '',
          clawdPath: args.clawd_path || DEFAULT_CLAWD_PATH,
          memoryDays: args.memory_days || 30
        });
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        await saveBaseline(profile, socialPath);
        return { success: true, data: profile };
      }
    },

    social_get_feed: {
      description: 'Generate smart feed from baseline + daily needs + graph data',
      parameters: {
        type: 'object',
        properties: {
          clawd_path: { type: 'string' },
          social_path: { type: 'string' }
        }
      },
      async execute(args) {
        const { generateFeed } = await loadLib('recommender');
        const { generateDailyNeeds, saveDailyNeeds } = await loadLib('daily-needs');
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        const clawdPath = args.clawd_path || DEFAULT_CLAWD_PATH;

        const needs = await generateDailyNeeds({ clawdPath });
        await saveDailyNeeds(needs, socialPath);
        const feed = await generateFeed({ socialPath, clawdPath });
        return { success: true, data: feed };
      }
    },

    social_collect_graph: {
      description: 'Collect graph data from AmikoNet, Moltbook, or import file',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['amikonet', 'moltbook', 'import'] },
          limit: { type: 'number' },
          sort: { type: 'string' },
          submolt: { type: 'string' },
          import_path: { type: 'string' },
          api_key: { type: 'string' },
          credentials: { type: 'string' },
          tools_path: { type: 'string' },
          base_url: { type: 'string' },
          include_comments: { type: 'boolean' },
          comments_limit: { type: 'number' },
          include_submolts: { type: 'boolean' },
          include_tags: { type: 'boolean' },
          social_path: { type: 'string' }
        }
      },
      async execute(args) {
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;

        if (args.import_path) {
          const content = await fs.readFile(args.import_path, 'utf-8');
          const data = JSON.parse(content);
          const nodes = data.nodes || data.agents || [];
          const edges = data.edges || [];
          const posts = data.posts || [];
          await fs.mkdir(socialPath, { recursive: true });
          await fs.writeFile(path.join(socialPath, 'nodes.json'), JSON.stringify(nodes, null, 2));
          await fs.writeFile(path.join(socialPath, 'edges.json'), JSON.stringify(edges, null, 2));
          await fs.writeFile(path.join(socialPath, 'posts.json'), JSON.stringify(posts, null, 2));
          return { success: true, data: { nodes: nodes.length, edges: edges.length, posts: posts.length } };
        }

        const source = args.source || 'amikonet';
        const { collectFromAmikoNet, collectFromMoltbook, saveGraphData } = await loadLib('collector');

        if (source === 'moltbook') {
          const result = await collectFromMoltbook({
            apiKey: args.api_key,
            credentials: args.credentials,
            toolsPath: args.tools_path,
            limit: args.limit,
            sort: args.sort,
            submolt: args.submolt,
            baseUrl: args.base_url,
            includeComments: args.include_comments,
            commentsLimit: args.comments_limit,
            includeSubmolts: args.include_submolts,
            includeTags: args.include_tags
          });
          await saveGraphData(result.posts, result.nodes, result.edges, socialPath);
          return { success: true, data: { nodes: result.nodes.length, edges: result.edges.length } };
        }

        const result = await collectFromAmikoNet({ limit: args.limit || 100 });
        await saveGraphData(result.posts, result.nodes, result.edges, socialPath);
        return { success: true, data: { nodes: result.nodes.length, edges: result.edges.length } };
      }
    },

    social_visualize_graph: {
      description: 'Generate graph visualization HTML',
      parameters: {
        type: 'object',
        properties: {
          social_path: { type: 'string' }
        }
      },
      async execute(args) {
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        await runCli(['graph', 'visualize', '--social-path', socialPath]);
        return { success: true, data: { social_path: socialPath } };
      }
    },

    social_find_connections: {
      description: 'Find neighbors or common connections in the graph',
      parameters: {
        type: 'object',
        properties: {
          node: { type: 'string' },
          hops: { type: 'number' },
          a: { type: 'string' },
          b: { type: 'string' },
          social_path: { type: 'string' }
        }
      },
      async execute(args) {
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        const { getNeighbors, commonNeighbors } = await loadLib('graph-engine');

        if (args.node) {
          return { success: true, data: await getNeighbors({ socialPath, node: args.node, hops: args.hops || 1 }) };
        }
        if (args.a && args.b) {
          return { success: true, data: await commonNeighbors({ socialPath, a: args.a, b: args.b }) };
        }

        return { success: false, error: 'Provide either node+hops or a+b.' };
      }
    },

    social_solana_create_challenge: {
      description: 'Create a Solana wallet-binding challenge for a Social OS handle',
      parameters: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          wallet_address: { type: 'string' },
          ttl_minutes: { type: 'number' },
          social_path: { type: 'string' }
        },
        required: ['handle', 'wallet_address']
      },
      async execute(args) {
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        const { createWalletBindingChallenge } = await loadLib('solana');
        const challenge = await createWalletBindingChallenge({
          socialPath,
          handle: args.handle,
          walletAddress: args.wallet_address,
          ttlMinutes: args.ttl_minutes || 10
        });
        return { success: true, data: challenge };
      }
    },

    social_solana_bind_wallet: {
      description: 'Verify signature for a challenge and bind a Solana wallet to a handle',
      parameters: {
        type: 'object',
        properties: {
          challenge_id: { type: 'string' },
          signature: { type: 'string' },
          handle: { type: 'string' },
          wallet_address: { type: 'string' },
          social_path: { type: 'string' }
        },
        required: ['challenge_id', 'signature']
      },
      async execute(args) {
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        const { verifyWalletBinding } = await loadLib('solana');
        const binding = await verifyWalletBinding({
          socialPath,
          challengeId: args.challenge_id,
          signature: args.signature,
          handle: args.handle,
          walletAddress: args.wallet_address
        });
        return { success: true, data: binding };
      }
    },

    social_solana_record_proof: {
      description: 'Record proof-of-interaction with optional on-chain tx verification',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          proof_type: { type: 'string' },
          context: { type: 'string' },
          offchain_data: {},
          tx_signature: { type: 'string' },
          network: { type: 'string' },
          rpc_url: { type: 'string' },
          verify_tx: { type: 'boolean' },
          social_path: { type: 'string' }
        },
        required: ['from', 'to', 'proof_type']
      },
      async execute(args) {
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        const { recordInteractionProof } = await loadLib('solana');
        const proof = await recordInteractionProof({
          socialPath,
          from: args.from,
          to: args.to,
          proofType: args.proof_type,
          context: args.context,
          offchainData: args.offchain_data,
          txSignature: args.tx_signature,
          network: args.network || 'devnet',
          rpcUrl: args.rpc_url,
          verifyTx: Boolean(args.verify_tx)
        });
        return { success: true, data: proof };
      }
    },

    social_solana_reward_payment: {
      description: 'Transfer SOL reward or record an existing reward settlement transaction',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['transfer_sol', 'record_tx'] },
          from_keypair_path: { type: 'string' },
          from_handle: { type: 'string' },
          to_handle: { type: 'string' },
          from_wallet: { type: 'string' },
          to_wallet: { type: 'string' },
          amount: { type: 'number' },
          asset: { type: 'string' },
          tx_signature: { type: 'string' },
          memo: { type: 'string' },
          note: { type: 'string' },
          network: { type: 'string' },
          rpc_url: { type: 'string' },
          verify_tx: { type: 'boolean' },
          social_path: { type: 'string' }
        },
        required: ['mode', 'to_wallet', 'amount']
      },
      async execute(args) {
        const socialPath = args.social_path || DEFAULT_SOCIAL_PATH;
        const network = args.network || 'devnet';
        const mode = args.mode || 'record_tx';
        const { transferSolReward, recordRewardPayment } = await loadLib('solana');

        if (mode === 'transfer_sol') {
          if (!args.from_keypair_path) {
            return { success: false, error: 'from_keypair_path is required for transfer_sol mode' };
          }
          const payment = await transferSolReward({
            socialPath,
            fromKeypairPath: args.from_keypair_path,
            toWallet: args.to_wallet,
            amountSol: Number(args.amount),
            network,
            rpcUrl: args.rpc_url,
            memo: args.memo,
            fromHandle: args.from_handle,
            toHandle: args.to_handle
          });
          return { success: true, data: payment };
        }

        if (!args.tx_signature) {
          return { success: false, error: 'tx_signature is required for record_tx mode' };
        }

        const payment = await recordRewardPayment({
          socialPath,
          fromHandle: args.from_handle,
          toHandle: args.to_handle,
          fromWallet: args.from_wallet || null,
          toWallet: args.to_wallet,
          amount: Number(args.amount),
          asset: args.asset || 'USDC',
          txSignature: args.tx_signature,
          network,
          rpcUrl: args.rpc_url,
          note: args.note,
          verifyTx: Boolean(args.verify_tx)
        });
        return { success: true, data: payment };
      }
    }
  }
};
