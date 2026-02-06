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
    }
  }
};
