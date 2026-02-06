/**
 * Collector - Fetch data from various sources (AmikoNet, Moltbook, etc.)
 * Unified graph data collection
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';

const AMIKONET_API_URL = process.env.AMIKONET_API_URL || 'https://amikonet.ai/api';
const TOKEN_FILE = path.join(os.homedir(), '.amikonet-token');

/**
 * Normalize different API response formats to posts array
 */
function normalizePosts(json) {
  if (Array.isArray(json)) return json;
  if (json?.posts) return json.posts;
  if (json?.data?.posts) return json.data.posts;
  if (json?.data) return Array.isArray(json.data) ? json.data : json.data.posts;
  if (json?.items) return json.items;
  return [];
}

/**
 * Extract @mentions from text
 */
function extractMentions(text) {
  if (!text) return [];
  const matches = text?.match(/@[a-zA-Z0-9_\-]+/g) || [];
  return Array.from(new Set(matches));
}

function extractTags(text) {
  if (!text) return [];
  const matches = text?.match(/#[a-zA-Z0-9_\-]+/g) || [];
  return Array.from(new Set(matches));
}

/**
 * Get Moltbook API key from various sources
 */
async function getMoltbookApiKey(options = {}) {
  // Direct API key
  if (options.apiKey) return options.apiKey;

  // Environment variable
  if (process.env.MOLTBOOK_API_KEY) return process.env.MOLTBOOK_API_KEY;

  // Credentials file
  if (options.credentials) {
    try {
      const content = await fs.readFile(options.credentials, 'utf-8');
      const creds = JSON.parse(content);
      if (creds.api_key) return creds.api_key;
    } catch {}
  }

  // Extract from TOOLS.md
  if (options.toolsPath) {
    try {
      const content = await fs.readFile(options.toolsPath, 'utf-8');
      // Match: API Key:** `key` or API Key: `key`
      const match = content.match(/\*?\*?API Key\*?\*?:[^\`]*\`([^\`]+)\`/i);
      if (match?.[1]) return match[1];
    } catch {}
  }

  return null;
}

/**
 * Collect from AmikoNet
 */
export async function collectFromAmikoNet(options = {}) {
  const limit = options.limit || 100;
  const token = await fs.readFile(TOKEN_FILE, 'utf-8').catch(() => null);

  if (!token) {
    throw new Error('Not authenticated. Run: ~/.openclaw/skills/amikonet/cli.js auth');
  }

  const response = await fetch(`${AMIKONET_API_URL}/posts?limit=${limit}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`AmikoNet API error: ${response.status}`);
  }

  const data = await response.json();
  const posts = normalizePosts(data);

  // Build graph
  const nodes = [];
  const edges = [];
  const nodeSet = new Set();

  for (const post of posts) {
    const author = post.author || {};
    if (!author.did) continue;

    const handle = author.handle ? `@${author.handle}` : author.did.substring(0, 20);

    if (!nodeSet.has(author.did)) {
      nodeSet.add(author.did);
      nodes.push({
        id: author.did,
        name: author.name || 'Unknown',
        handle: handle,
        did: author.did,
        privacy: 'graph',
        source: 'amikonet'
      });
    }

    // Extract mentions
    const mentions = extractMentions(post.content);
    for (const mention of mentions) {
      edges.push({
        from: handle,
        to: mention,
        type: 'mention',
        context: post.content?.substring(0, 50),
        timestamp: post.createdAt || new Date().toISOString(),
        source: 'amikonet'
      });
    }
  }

  return { posts, nodes, edges, source: 'amikonet' };
}

/**
 * Collect from Moltbook
 */
export async function collectFromMoltbook(options = {}) {
  const baseUrl = options.baseUrl || 'https://www.moltbook.com/api/v1';
  const apiKey = await getMoltbookApiKey(options);
  const includeComments = options.includeComments !== false;
  const commentsLimit = options.commentsLimit ? Number(options.commentsLimit) : 20;
  const includeSubmolts = options.includeSubmolts !== false;
  const includeTags = options.includeTags !== false;

  if (!apiKey) {
    throw new Error('Missing Moltbook API key. Provide --api-key, set MOLTBOOK_API_KEY, or pass --credentials/--tools-path.');
  }
  if (!baseUrl.startsWith('https://www.moltbook.com/')) {
    throw new Error('Invalid Moltbook base URL. Use https://www.moltbook.com/api/v1 to avoid Authorization header stripping.');
  }

  // Build URL
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/posts`);
  if (options.limit) url.searchParams.set('limit', String(options.limit));
  if (options.sort) url.searchParams.set('sort', options.sort);
  if (options.submolt) url.searchParams.set('submolt', options.submolt);

  // Fetch posts
  const response = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Moltbook API error ${response.status}: ${text}`);
  }

  const json = await response.json();
  const rawPosts = normalizePosts(json);

  async function fetchComments(postId) {
    const commentsUrl = new URL(`${baseUrl.replace(/\/$/, '')}/posts/${postId}/comments`);
    if (commentsLimit) commentsUrl.searchParams.set('limit', String(commentsLimit));
    const res = await fetch(commentsUrl.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) return [];
    const json = await res.json();
    return normalizePosts(json);
  }

  // Build graph and normalize posts to match expected format
  const nodesById = new Map();
  const edges = [];
  const posts = [];

  function upsertNode(node) {
    if (!node?.id) return;
    if (!nodesById.has(node.id)) {
      nodesById.set(node.id, { ...node, privacy: 'graph', source: 'moltbook' });
    }
  }

  for (const post of rawPosts) {
    const author = post.author || {};
    const authorName = author.name || author.handle || author.id || 'unknown';
    const authorId = author.id || author.name || author.handle || authorName;
    const authorHandle = author.handle || `@${authorName}`;

    upsertNode({
      id: authorId,
      name: author.name || author.handle || authorId,
      handle: authorHandle,
      meta: {
        karma: author.karma,
        follower_count: author.follower_count,
        following_count: author.following_count
      }
    });

    // Extract mentions/tags from title, content, url
    const text = [post.title, post.content, post.url].filter(Boolean).join(' ');
    const mentions = extractMentions(text);
    const tags = includeTags ? extractTags(text) : [];

    for (const mention of mentions) {
      edges.push({
        from: authorHandle,
        to: mention,
        type: 'mention',
        context: post.title || post.id || 'post',
        timestamp: post.created_at || new Date().toISOString(),
        source: 'moltbook'
      });
    }

    if (includeSubmolts && post.submolt?.name) {
      const submoltNodeId = `#submolt:${post.submolt.name}`;
      upsertNode({ id: submoltNodeId, name: post.submolt.display_name || post.submolt.name, handle: submoltNodeId });
      edges.push({
        from: authorHandle,
        to: submoltNodeId,
        type: 'submolt',
        context: post.submolt.name,
        timestamp: post.created_at || new Date().toISOString(),
        source: 'moltbook'
      });
    }

    for (const tag of tags) {
      const tagNodeId = `#tag:${tag.replace('#', '')}`;
      upsertNode({ id: tagNodeId, name: tag, handle: tagNodeId });
      edges.push({
        from: authorHandle,
        to: tagNodeId,
        type: 'tag',
        context: tag,
        timestamp: post.created_at || new Date().toISOString(),
        source: 'moltbook'
      });
    }

    // Normalize post format for recommender compatibility
    posts.push({
      id: post.id,
      title: post.title,
      content: post.content,
      author_handle: authorHandle,
      author_name: authorName,
      author: { ...author, handle: authorHandle },
      timestamp: post.created_at || new Date().toISOString(),
      upvotes: post.upvotes || 0,
      comment_count: post.comment_count || 0,
      submolt: post.submolt?.name || post.submolt?.display_name || 'general',
      source: 'moltbook',
      // For recommender preview
      preview: post.title || (post.content || '').substring(0, 100)
    });

    if (includeComments && post.comment_count > 0) {
      const comments = await fetchComments(post.id);
      for (const comment of comments) {
        const commentAuthor = comment.author || {};
        const commentAuthorName = commentAuthor.name || commentAuthor.handle || commentAuthor.id || 'unknown';
        const commentAuthorId = commentAuthor.id || commentAuthor.name || commentAuthor.handle || commentAuthorName;
        const commentAuthorHandle = commentAuthor.handle || `@${commentAuthorName}`;

        upsertNode({
          id: commentAuthorId,
          name: commentAuthor.name || commentAuthor.handle || commentAuthorId,
          handle: commentAuthorHandle,
          meta: {
            karma: commentAuthor.karma,
            follower_count: commentAuthor.follower_count,
            following_count: commentAuthor.following_count
          }
        });

        edges.push({
          from: commentAuthorHandle,
          to: authorHandle,
          type: 'comment',
          context: (comment.content || '').substring(0, 50),
          timestamp: comment.created_at || new Date().toISOString(),
          source: 'moltbook'
        });

        const commentMentions = extractMentions(comment.content || '');
        for (const mention of commentMentions) {
          edges.push({
            from: commentAuthorHandle,
            to: mention,
            type: 'mention',
            context: (comment.content || '').substring(0, 50),
            timestamp: comment.created_at || new Date().toISOString(),
            source: 'moltbook'
          });
        }

        if (includeTags) {
          const commentTags = extractTags(comment.content || '');
          for (const tag of commentTags) {
            const tagNodeId = `#tag:${tag.replace('#', '')}`;
            upsertNode({ id: tagNodeId, name: tag, handle: tagNodeId });
            edges.push({
              from: commentAuthorHandle,
              to: tagNodeId,
              type: 'tag',
              context: tag,
              timestamp: comment.created_at || new Date().toISOString(),
              source: 'moltbook'
            });
          }
        }
      }
    }
  }

  const nodes = Array.from(nodesById.values());

  return { posts, nodes, edges, source: 'moltbook' };
}

/**
 * Save collected data to storage
 */
export async function saveGraphData(posts, nodes, edges, socialPath) {
  await fs.mkdir(socialPath, { recursive: true });

  await Promise.all([
    fs.writeFile(
      path.join(socialPath, 'posts.json'),
      JSON.stringify(posts, null, 2),
      'utf-8'
    ),
    fs.writeFile(
      path.join(socialPath, 'nodes.json'),
      JSON.stringify(nodes, null, 2),
      'utf-8'
    ),
    fs.writeFile(
      path.join(socialPath, 'edges.json'),
      JSON.stringify(edges, null, 2),
      'utf-8'
    )
  ]);
}
