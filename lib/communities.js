/**
 * Communities - Label propagation clustering
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

function buildAdjacency(edges) {
  const adj = new Map();
  const add = (a, b) => {
    if (!a || !b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const e of edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return adj;
}

export async function labelPropagation({ socialPath, iterations = 10 }) {
  const { nodes, edges } = await loadGraph(socialPath);
  const adj = buildAdjacency(edges);
  const keys = nodes.map(n => n.handle || n.id || n.did).filter(Boolean);

  const labels = {};
  keys.forEach(k => (labels[k] = k));

  for (let i = 0; i < iterations; i++) {
    for (const k of keys) {
      const neighbors = Array.from(adj.get(k) || []);
      if (!neighbors.length) continue;
      const counts = {};
      for (const n of neighbors) {
        const label = labels[n];
        counts[label] = (counts[label] || 0) + 1;
      }
      let bestLabel = labels[k];
      let bestCount = -1;
      for (const [label, count] of Object.entries(counts)) {
        if (count > bestCount) {
          bestCount = count;
          bestLabel = label;
        }
      }
      labels[k] = bestLabel;
    }
  }

  return labels;
}
