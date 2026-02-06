/**
 * Metadata Storage - Track timestamps and statistics
 * Quick win from Codex: surface timing info for debugging and user awareness
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DEFAULT_SOCIAL_PATH = path.join(os.homedir(), 'clawd-work', 'social');

/**
 * Default metadata structure
 */
const DEFAULT_METADATA = {
  version: '1.0.0',
  created_at: new Date().toISOString(),
  last_updated: new Date().toISOString(),
  baseline: {
    last_updated: null,
    profile_generated_at: null
  },
  collection: {
    last_run: null,
    source: null, // 'amikonet' | 'import' | 'manual'
  },
  graph: {
    nodes_count: 0,
    edges_count: 0,
    last_updated: null
  },
  feed: {
    last_generated: null,
    items_count: 0
  }
};

/**
 * Load metadata
 */
export async function loadMetadata(socialPath = DEFAULT_SOCIAL_PATH) {
  try {
    await fs.mkdir(socialPath, { recursive: true });
    const content = await fs.readFile(path.join(socialPath, 'metadata.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    // Return default if doesn't exist
    return { ...DEFAULT_METADATA };
  }
}

/**
 * Save metadata
 */
export async function saveMetadata(metadata, socialPath = DEFAULT_SOCIAL_PATH) {
  await fs.mkdir(socialPath, { recursive: true });
  metadata.last_updated = new Date().toISOString();
  await fs.writeFile(path.join(socialPath, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * Update baseline timestamp
 */
export async function updateBaseline(socialPath = DEFAULT_SOCIAL_PATH) {
  const metadata = await loadMetadata(socialPath);
  metadata.baseline.last_updated = new Date().toISOString();
  metadata.baseline.profile_generated_at = new Date().toISOString();
  await saveMetadata(metadata, socialPath);
}

/**
 * Update collection timestamp
 */
export async function updateCollection(source = 'amikonet', socialPath = DEFAULT_SOCIAL_PATH) {
  const metadata = await loadMetadata(socialPath);
  metadata.collection.last_run = new Date().toISOString();
  metadata.collection.source = source;
  await saveMetadata(metadata, socialPath);
}

/**
 * Update graph stats
 */
export async function updateGraphStats(nodesCount, edgesCount, socialPath = DEFAULT_SOCIAL_PATH) {
  const metadata = await loadMetadata(socialPath);
  metadata.graph.nodes_count = nodesCount;
  metadata.graph.edges_count = edgesCount;
  metadata.graph.last_updated = new Date().toISOString();
  await saveMetadata(metadata, socialPath);
}

/**
 * Update feed timestamp
 */
export async function updateFeed(itemsCount = 0, socialPath = DEFAULT_SOCIAL_PATH) {
  const metadata = await loadMetadata(socialPath);
  metadata.feed.last_generated = new Date().toISOString();
  metadata.feed.items_count = itemsCount;
  await saveMetadata(metadata, socialPath);
}

/**
 * Get formatted metadata for display
 */
export async function getMetadataSummary(socialPath = DEFAULT_SOCIAL_PATH) {
  const metadata = await loadMetadata(socialPath);

  return {
    baseline: metadata.baseline.last_updated ?
      `${new Date(metadata.baseline.last_updated).toLocaleDateString()}` :
      'Not generated',
    collection: metadata.collection.last_run ?
      `${new Date(metadata.collection.last_run).toLocaleDateString()} (${metadata.collection.source})` :
      'Never collected',
    source: metadata.collection.source,
    graph: metadata.graph.last_updated ?
      `${metadata.graph.nodes_count} nodes, ${metadata.graph.edges_count} edges` :
      'Empty graph',
    feed: metadata.feed.last_generated ?
      `${new Date(metadata.feed.last_generated).toLocaleTimeString()} (${metadata.feed.items_count} items)` :
      'Never generated'
  };
}
