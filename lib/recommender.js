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
function expandKeywords(keywords = []) {
  const expansions = {
    ai: ['artificial intelligence', 'ml', 'machine learning', 'agents', 'agent'],
    web3: ['blockchain', 'onchain', 'crypto', 'token', 'tokens'],
    cryptocurrency: ['crypto', 'token', 'tokens'],
    trading: ['trader', 'markets', 'market', 'alpha'],
    investing: ['investor', 'portfolio', 'fund'],
    security: ['secure', 'audit', 'vulnerability'],
    'vibe coding': ['coding', 'builder', 'build', 'shipping']
  };

  const set = new Set();
  for (const k of keywords) {
    if (!k) continue;
    const key = k.toLowerCase();
    set.add(key);
    const extra = expansions[key];
    if (extra) extra.forEach(e => set.add(e));
  }
  return Array.from(set);
}

function calculateRelevance(dailyNeeds, content, baseline) {
  const needs = [
    ...dailyNeeds.current_focus.primary,
    ...dailyNeeds.current_focus.curious_about
  ];
  const stuckPoints = dailyNeeds.current_focus.stuck_points || [];

  const interestKeywords = expandKeywords(baseline?.capabilities?.interests || []);
  const contentText = JSON.stringify(content).toLowerCase();
  let matches = 0;
  let stuckMatches = 0;
  let interestMatches = 0;

  for (const need of needs) {
    if (contentText.includes(need.toLowerCase())) {
      matches++;
    }
  }

  for (const kw of interestKeywords) {
    if (contentText.includes(kw)) {
      interestMatches++;
    }
  }

  for (const stuck of stuckPoints) {
    if (contentText.includes(stuck.toLowerCase())) {
      stuckMatches++;
    }
  }

  let score = Math.min(matches / Math.max(needs.length, 1), 1);
  if (interestMatches > 0) {
    score = Math.min(1, score + Math.min(0.3, interestMatches * 0.05));
  }
  if (stuckMatches > 0) {
    score = Math.min(1, score + 0.2);
  }

  return { score, stuckMatches, interestMatches };
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

function calculateMutualFriends(myHandle, agentHandle, graph) {
  const friendsOfMine = graph.edges
    .filter(e => e.from === myHandle)
    .map(e => e.to);

  const theirFriends = graph.edges
    .filter(e => e.from === agentHandle)
    .map(e => e.to);

  const mutualFriends = friendsOfMine.filter(f => theirFriends.includes(f));
  return mutualFriends.length;
}

function calculateCommunityMatch(myHandle, agentHandle, graph) {
  const myNode = graph.nodes.find(n => n.handle === myHandle);
  const theirNode = graph.nodes.find(n => n.handle === agentHandle);
  if (myNode && theirNode && myNode.community && theirNode.community) {
    return myNode.community === theirNode.community ? 1 : 0;
  }
  return 0;
}

function inferCommunityFromSubmolt(post) {
  if (post.submolt && typeof post.submolt === 'string') {
    return `#submolt:${post.submolt}`;
  }
  return null;
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

  // Ensure "self" node exists for matching when no posts yet
  if (baseline?.agent?.amikonet_handle && !graph.nodes.find(n => n.handle === baseline.agent.amikonet_handle)) {
    graph.nodes.push({
      id: baseline.agent.amikonet_handle,
      name: baseline.identity.name,
      handle: baseline.agent.amikonet_handle,
      source: 'manual'
    });
  }

  // Load available posts/content
  const posts = await loadPosts(socialPath);

  // Score each item
  const scored = [];

  for (const post of posts) {
    const relevanceResult = dailyNeeds ? calculateRelevance(dailyNeeds, post, baseline) : { score: 0, stuckMatches: 0, interestMatches: 0 };
    const relevance = relevanceResult.score;
    const selfHandle = baseline.agent.amikonet_handle || '';
    const connectionStrength = selfHandle ?
      calculateConnectionStrength(selfHandle, post.author_handle, graph) : 0;
    const mutualCount = selfHandle ?
      calculateMutualFriends(selfHandle, post.author_handle, graph) : 0;
    const communityMatch = selfHandle ?
      calculateCommunityMatch(selfHandle, post.author_handle, graph) : 0;
    const inferredCommunity = inferCommunityFromSubmolt(post);
    const recency = calculateRecency(post.timestamp);
    const activity = calculateActivity(post.author_handle, graph);

    const mutualBonus = Math.min(mutualCount * 0.05, 0.2);
    const communityBonus = (communityMatch || (inferredCommunity && baseline?.agent?.amikonet_handle)) ? 0.1 : 0;
    const score = (relevance * 0.4) + (connectionStrength * 0.3) + (recency * 0.2) + (activity * 0.1) + mutualBonus + communityBonus;

    let reason = null;
    if (communityMatch) {
      reason = `Same community`;
    } else if (inferredCommunity) {
      reason = `Submolt: ${inferredCommunity.replace('#submolt:', '')}`;
    } else if (relevanceResult.stuckMatches > 0) {
      reason = `Matches stuck points (${relevanceResult.stuckMatches})`;
    } else if (mutualCount > 0) {
      reason = `Mutual connections: ${mutualCount}`;
    } else if (relevanceResult.interestMatches > 0) {
      reason = `Matches interests (${relevanceResult.interestMatches})`;
    }

    scored.push({
      ...post,
      score: Math.round(score * 1000) / 1000,
      relevance: Math.round(relevance * 1000) / 1000,
      connection_strength: Math.round(connectionStrength * 1000) / 1000,
      mutual_count: mutualCount,
      reason,
      section: determineSection(score, relevance, connectionStrength, mutualCount)
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
function determineSection(score, relevance, connectionStrength, mutualCount) {
  if (relevance > 0.6) {
    return 'high_priority';
  } else if (connectionStrength > 0.3 && connectionStrength < 0.7) {
    return 'explore';
  } else if (connectionStrength >= 0.7) {
    return 'community';
  } else if (mutualCount >= 2) {
    return 'people_you_should_know';
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
    people_you_should_know: feedResult.feed.filter(f => f.section === 'people_you_should_know'),
    serendipity: feedResult.feed.filter(f => f.section === 'serendipity')
  };

  for (const [sectionName, items] of Object.entries(sections)) {
    if (items.length === 0) continue;

    const icons = {
      high_priority: '🔴',
      explore: '🟡',
      community: '🟢',
      people_you_should_know: '🟣',
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
