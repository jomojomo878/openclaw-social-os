/**
 * Graph Engine - Core graph queries
 */

import fs from 'fs/promises';
import path from 'path';

async function loadGraph(socialPath) {
  const nodesPath = path.join(socialPath, 'nodes.json');
  const edgesPath = path.join(socialPath, 'edges.json');

  const [nodes, edges] = await Promise.all([
    fs.readFile(nodesPath, 'utf-8').then(JSON.parse).catch(() => []),
    fs.readFile(edgesPath, 'utf-8').then(JSON.parse).catch(() => [])
  ]);

  return { nodes, edges };
}

function buildNodeIndex(nodes) {
  const nodeByKey = new Map();

  for (const node of nodes) {
    const id = node.id || node.did;
    const handle = node.handle;

    if (id) nodeByKey.set(id, node);
    if (handle) nodeByKey.set(handle, node);
    if (handle && handle.startsWith('@')) {
      nodeByKey.set(handle.slice(1), node);
    }
  }

  return nodeByKey;
}

function resolveNodeKey(input, nodeByKey) {
  if (!input) return null;
  if (nodeByKey.has(input)) return input;
  const withAt = input.startsWith('@') ? input : `@${input}`;
  if (nodeByKey.has(withAt)) return withAt;
  if (nodeByKey.has(input.replace(/^@/, ''))) return input.replace(/^@/, '');
  return null;
}

function buildAdjacency(edges) {
  const adjacency = new Map();

  const addEdge = (from, to) => {
    if (!from || !to) return;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };

  for (const edge of edges) {
    addEdge(edge.from, edge.to);
    addEdge(edge.to, edge.from); // treat as undirected for now
  }

  return adjacency;
}

export async function getNeighbors({ socialPath, node, hops = 1 }) {
  const graph = await loadGraph(socialPath);
  const nodeByKey = buildNodeIndex(graph.nodes);
  const startKey = resolveNodeKey(node, nodeByKey);

  if (!startKey) {
    throw new Error(`Node not found: ${node}`);
  }

  const adjacency = buildAdjacency(graph.edges);
  const visited = new Set([startKey]);
  let frontier = new Set([startKey]);

  for (let i = 0; i < hops; i++) {
    const next = new Set();
    for (const current of frontier) {
      const neighbors = adjacency.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
  }

  const nodes = graph.nodes.filter(n => {
    const key = n.handle || n.id || n.did;
    return visited.has(key) || visited.has(n.id) || visited.has(n.handle);
  });

  const edges = graph.edges.filter(e => visited.has(e.from) && visited.has(e.to));

  return { startKey, nodes, edges };
}

export async function shortestPath({ socialPath, from, to }) {
  const graph = await loadGraph(socialPath);
  const nodeByKey = buildNodeIndex(graph.nodes);
  const fromKey = resolveNodeKey(from, nodeByKey);
  const toKey = resolveNodeKey(to, nodeByKey);

  if (!fromKey || !toKey) {
    throw new Error(`Node not found: ${!fromKey ? from : to}`);
  }

  const adjacency = buildAdjacency(graph.edges);
  const queue = [fromKey];
  const visited = new Set([fromKey]);
  const prev = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === toKey) break;

    const neighbors = adjacency.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        prev.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  if (!visited.has(toKey)) return { fromKey, toKey, path: [] };

  const path = [];
  let cursor = toKey;
  while (cursor) {
    path.unshift(cursor);
    cursor = prev.get(cursor);
  }

  return { fromKey, toKey, path };
}

export async function commonNeighbors({ socialPath, a, b }) {
  const graph = await loadGraph(socialPath);
  const nodeByKey = buildNodeIndex(graph.nodes);
  const aKey = resolveNodeKey(a, nodeByKey);
  const bKey = resolveNodeKey(b, nodeByKey);

  if (!aKey || !bKey) {
    throw new Error(`Node not found: ${!aKey ? a : b}`);
  }

  const adjacency = buildAdjacency(graph.edges);
  const aNeighbors = adjacency.get(aKey) || new Set();
  const bNeighbors = adjacency.get(bKey) || new Set();
  const common = Array.from(aNeighbors).filter(n => bNeighbors.has(n));

  return { aKey, bKey, common };
}
