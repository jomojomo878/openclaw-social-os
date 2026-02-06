/**
 * Smart Recommender - Generate personalized feed
 * Combines baseline + daily needs + social graph
 */

import * as Baseline from './baseline.js';
import * as DailyNeeds from './daily-needs.js';
import path from 'path';
import os from 'os';

const DEFAULT_CLAWD_PATH = path.join(os.homedir(), 'clawd-work');
const DEFAULT_SOCIAL_PATH = path.join(DEFAULT_CLAWD_PATH, 'social');

/**
 * Calculate relevance score between needs and content
 */
function calculateRelevance(dailyNeeds, content) {
  const needs = [
    ...dailyNeeds.current_focus.primary,
    ...dailyNeeds.current_focus.curious_about
  ];

  const contentText = JSON.stringify(content).toLowerCase();
  let matches = 0;

  for (const need of needs) {
    if (contentText.includes(need.toLowerCase())) {
      matches++;
    }
  }

  return Math.min(matches / Math.max(needs.length, 1), 1);
}

/**
 * Calculate connection strength based on social graph
 */
function calculateConnectionStrength(myHandle, agentHandle, graph) {
  // Check if direct connection exists
  const directEdge = graph.edges.find(
    e => (e.from === myHandle && e.to === agentHandle) ||
         (e.from === agentHandle && e.to === myHandle)
  );

  if (directEdge) {
    return directEdge.strength || 0.5;
  }

  // Check 2-hop connection (friend of friend)
  const friendsOfMine = graph.edges
    .filter(e => e.from === myHandle)
    .map(e => e.to);

  const theirFriends = graph.edges
    .filter(e => e.from === agentHandle)
    .map(e => e.to);

  const mutualFriends = friendsOfMine.filter(f => theirFriends.includes(f));

  if (mutualFriends.length > 0) {
    return 0.3 + (mutualFriends.length * 0.1);
  }

  // Check same community
  const myNode = graph.nodes.find(n => n.handle === myHandle);
  const theirNode = graph.nodes.find(n => n.handle === agentHandle);

  if (myNode && theirNode && myNode.community === theirNode.community) {
    return 0.2;
  }

  return 0;
}

/**
 * Generate smart feed
 */
export async function generateFeed(options = {}) {
  const {
    clawdPath = DEFAULT_CLAWD_PATH,
    socialPath = DEFAULT_SOCIAL_PATH
  } = options;

  // Load baseline and daily needs
  const baseline = await Baseline.loadBaseline(socialPath);
  const dailyNeeds = await DailyNeeds.loadDailyNeeds(socialPath);

  if (!baseline) {
    return {
      error: 'Baseline not found. Run: social baseline'
    };
  }

  // Load social graph
  const graph = await loadGraph(socialPath);

  // Load available posts/content
  const posts = await loadPosts(socialPath);

  // Score each item
  const scored = [];

  for (const post of posts) {
    const relevance = dailyNeeds ? calculateRelevance(dailyNeeds, post) : 0;
    const connectionStrength = baseline.agent.amikonet_handle ?
      calculateConnectionStrength(baseline.agent.amikonet_handle, post.author_handle, graph) : 0;
    const recency = calculateRecency(post.timestamp);
    const activity = calculateActivity(post.author_handle, graph);

    const score = (relevance * 0.4) + (connectionStrength * 0.3) + (recency * 0.2) + (activity * 0.1);

    scored.push({
      ...post,
      score: Math.round(score * 1000) / 1000,
      relevance: Math.round(relevance * 1000) / 1000,
      connection_strength: Math.round(connectionStrength * 1000) / 1000,
      section: determineSection(score, relevance, connectionStrength)
    });
  }

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Filter by threshold, but always show at least 5 posts for serendipity
  const feed = scored.filter(item => item.score > 0.05).slice(0, 20);
  const feedToShow = feed.length > 0 ? feed : scored.slice(0, 5);

  return {
    generated_at: new Date().toISOString(),
    baseline: {
      name: baseline.identity.name,
      capabilities: baseline.capabilities
    },
    daily_needs: dailyNeeds ? dailyNeeds.current_focus : null,
    feed: feedToShow
  };
}

/**
 * Determine feed section
 */
function determineSection(score, relevance, connectionStrength) {
  if (relevance > 0.6) {
    return 'high_priority';
  } else if (connectionStrength > 0.3 && connectionStrength < 0.7) {
    return 'explore';
  } else if (connectionStrength >= 0.7) {
    return 'community';
  } else {
    return 'serendipity';
  }
}

/**
 * Calculate recency score (decays over time)
 */
function calculateRecency(timestamp) {
  const now = Date.now();
  const postTime = new Date(timestamp).getTime();
  const hoursAgo = (now - postTime) / (1000 * 60 * 60);

  // Decay: 1.0 for recent, 0.5 for 24h, 0.1 for week+
  if (hoursAgo < 6) return 1.0;
  if (hoursAgo < 24) return 0.5;
  if (hoursAgo < 168) return 0.3;
  return 0.1;
}

/**
 * Calculate activity score for an agent
 */
function calculateActivity(handle, graph) {
  const agentEdges = graph.edges.filter(
    e => e.from === handle || e.to === handle
  );

  if (agentEdges.length === 0) return 0.1;
  if (agentEdges.length < 5) return 0.3;
  if (agentEdges.length < 15) return 0.6;
  return 1.0;
}

/**
 * Load social graph
 */
async function loadGraph(socialPath) {
  const fs = await import('fs/promises');

  try {
    const nodesPath = path.join(socialPath, 'nodes.json');
    const edgesPath = path.join(socialPath, 'edges.json');

    const [nodes, edges] = await Promise.all([
      fs.readFile(nodesPath, 'utf-8').then(JSON.parse).catch(() => []),
      fs.readFile(edgesPath, 'utf-8').then(JSON.parse).catch(() => [])
    ]);

    return { nodes, edges };
  } catch {
    return { nodes: [], edges: [] };
  }
}

/**
 * Load posts (placeholder - will be populated by collector)
 */
async function loadPosts(socialPath) {
  const fs = await import('fs/promises');

  try {
    const postsPath = path.join(socialPath, 'posts.json');
    const posts = await fs.readFile(postsPath, 'utf-8').then(JSON.parse).catch(() => []);
    return posts;
  } catch {
    return [];
  }
}

/**
 * Format feed for display
 */
export function formatFeed(feedResult) {
  if (feedResult.error) {
    return `❌ ${feedResult.error}`;
  }

  let output = '';

  output += `┌─────────────────────────────────────────────────────────┐\n`;
  output += `│  YOUR FEED - ${feedResult.generated_at.split('T')[0]}                      │\n`;
  output += `├─────────────────────────────────────────────────────────┤\n`;
  output += `│  You: ${feedResult.baseline.name}                                 │\n`;
  output += `│  Strengths: ${feedResult.baseline.capabilities.core_strengths.join(', ')}\n`;

  if (feedResult.daily_needs) {
    output += `│                                                         │\n`;
    output += `│  🔴 FOCUS: ${feedResult.daily_needs.primary.join(', ')}             │\n`;
    if (feedResult.daily_needs.curious_about.length > 0) {
      output += `│  Curious: ${feedResult.daily_needs.curious_about.join(', ')}        │\n`;
    }
  }

  output += `└─────────────────────────────────────────────────────────┘\n\n`;

  // Show scoring weights (Codex suggestion: explicit for tuning and explainability)
  output += `📊 Scoring weights:\n`;
  output += `   Relevance (to your focus): 40%\n`;
  output += `   Connection strength: 30%\n`;
  output += `   Recency: 20%\n`;
  output += `   Activity level: 10%\n\n`;

  // Group by section
  const sections = {
    high_priority: feedResult.feed.filter(f => f.section === 'high_priority'),
    explore: feedResult.feed.filter(f => f.section === 'explore'),
    community: feedResult.feed.filter(f => f.section === 'community'),
    serendipity: feedResult.feed.filter(f => f.section === 'serendipity')
  };

  for (const [sectionName, items] of Object.entries(sections)) {
    if (items.length === 0) continue;

    const icons = {
      high_priority: '🔴',
      explore: '🟡',
      community: '🟢',
      serendipity: '🔵'
    };

    output += `${icons[sectionName]} ${sectionName.replace('_', ' ').toUpperCase()}\n\n`;

    for (const item of items.slice(0, 5)) {
      const scorePercent = Math.round(item.score * 100);
      output += `   ${item.author_handle} · ${scorePercent}% match\n`;

      // Show breakdown for top items (Codex suggestion)
      output += `   └─ relevance:${Math.round(item.relevance * 100)}% `;
      output += `connection:${Math.round(item.connection_strength * 100)}% `;

      if (item.reason) {
        output += `\n   → ${item.reason}`;
      }
      if (item.preview) {
        output += `\n   "${item.preview.substring(0, 60)}..."`;
      }
      output += '\n';
    }
  }

  if (feedResult.feed.length === 0) {
    output += `   No recommendations yet. Run: social graph collect\n`;
  }

  return output;
}
