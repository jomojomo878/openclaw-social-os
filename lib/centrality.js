/**
 * Centrality Metrics - PageRank, Degree, Betweenness
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

export async function degreeCentrality({ socialPath }) {
  const { nodes, edges } = await loadGraph(socialPath);
  const adj = buildAdjacency(edges);
  const scores = {};

  for (const node of nodes) {
    const key = node.handle || node.id || node.did;
    scores[key] = (adj.get(key) || new Set()).size;
  }

  return scores;
}

export async function pageRank({ socialPath, iterations = 20, damping = 0.85 }) {
  const { nodes, edges } = await loadGraph(socialPath);
  const adj = buildAdjacency(edges);
  const keys = nodes.map(n => n.handle || n.id || n.did).filter(Boolean);

  const N = keys.length || 1;
  const rank = {};
  keys.forEach(k => (rank[k] = 1 / N));

  for (let i = 0; i < iterations; i++) {
    const newRank = {};
    keys.forEach(k => (newRank[k] = (1 - damping) / N));

    for (const k of keys) {
      const neighbors = adj.get(k) || new Set();
      const outDegree = neighbors.size || 1;
      for (const n of neighbors) {
        if (newRank[n] === undefined) newRank[n] = (1 - damping) / N;
        newRank[n] += damping * (rank[k] / outDegree);
      }
    }
    keys.forEach(k => (rank[k] = newRank[k] || 0));
  }

  return rank;
}

export async function betweennessCentrality({ socialPath }) {
  const { nodes, edges } = await loadGraph(socialPath);
  const adj = buildAdjacency(edges);
  const keys = nodes.map(n => n.handle || n.id || n.did).filter(Boolean);
  const scores = {};
  keys.forEach(k => (scores[k] = 0));

  for (const s of keys) {
    const stack = [];
    const preds = {};
    const sigma = {};
    const dist = {};

    keys.forEach(v => {
      preds[v] = [];
      sigma[v] = 0;
      dist[v] = -1;
    });

    sigma[s] = 1;
    dist[s] = 0;
    const queue = [s];

    while (queue.length) {
      const v = queue.shift();
      stack.push(v);
      const neighbors = adj.get(v) || new Set();
      for (const w of neighbors) {
        if (dist[w] < 0) {
          queue.push(w);
          dist[w] = dist[v] + 1;
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      }
    }

    const delta = {};
    keys.forEach(v => (delta[v] = 0));

    while (stack.length) {
      const w = stack.pop();
      for (const v of preds[w]) {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      }
      if (w !== s) scores[w] += delta[w];
    }
  }

  return scores;
}
