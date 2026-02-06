#!/usr/bin/env node
/**
 * Social OS CLI - Command-line interface for the Social Operating System
 */

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLAWD_PATH = path.join(os.homedir(), 'clawd-work');
const DEFAULT_SOCIAL_PATH = path.join(DEFAULT_CLAWD_PATH, 'social');
const AMIKONET_API_URL = process.env.AMIKONET_API_URL || 'https://amikonet.ai/api';
const TOKEN_FILE = path.join(os.homedir(), '.amikonet-token');

/**
 * Parse command line arguments
 * Converts --kebab-case to camelCase for easier access
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = {};

  const toCamelCase = (str) => str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = toCamelCase(arg.slice(2));
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        options[key] = value;
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return { command, options, positional: args.slice(1).filter(a => !a.startsWith('--')) };
}

/**
 * Load a module from lib
 */
async function loadLib(name) {
  const modulePath = path.join(__dirname, 'lib', `${name}.js`);
  return (await import(`file://${modulePath}`));
}

/**
 * Generate baseline profile
 */
async function cmdBaseline(options) {
  const isRefresh = options.refresh === 'true';
  console.error(isRefresh ? '🔄 Refreshing baseline profile...' : '📊 Generating baseline profile...');

  const { generateBaseline, saveBaseline } = await loadLib('baseline');

  const profile = await generateBaseline({
    agentDid: options.did || process.env.AGENT_DID,
    agentName: options.name || 'Jojo',
    amikonetHandle: options.handle || process.env.AMIKONET_HANDLE || '',
    clawdPath: options.clawdPath || DEFAULT_CLAWD_PATH,
    memoryDays: parseInt(options.memoryDays) || 30
  });

  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  await saveBaseline(profile, socialPath);

  console.error(`✅ Baseline saved to ${socialPath}/baseline.json`);
  console.error();
  console.error(`   ${profile.identity.name} ${profile.identity.emoji}`);
  console.error(`   Strengths: ${profile.capabilities.core_strengths.join(', ')}`);
  console.error(`   Skills: ${profile.capabilities.skills.slice(0, 5).join(', ')}`);
  console.error(`   Interests: ${profile.capabilities.interests.slice(0, 5).join(', ')}`);
  console.error(`   Communication: ${profile.personality.communication_style}`);
  console.error(`   Collaboration: ${profile.personality.collaboration_style}`);

  return { success: true, profile };
}

/**
 * Generate daily feed
 */
async function cmdFeed(options) {
  console.error('📰 Generating your smart feed...');

  const { generateFeed, formatFeed } = await loadLib('recommender');
  const { generateDailyNeeds, saveDailyNeeds } = await loadLib('daily-needs');

  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  const clawdPath = options.clawdPath || DEFAULT_CLAWD_PATH;

  // Generate daily needs
  const needs = await generateDailyNeeds({ clawdPath });
  await saveDailyNeeds(needs, socialPath);

  // Generate feed
  const feed = await generateFeed({ socialPath, clawdPath });

  // Update feed metadata with actual item count
  const { updateFeed } = await import('./lib/metadata.js');
  await updateFeed(feed.feed?.length || 0, socialPath);

  console.error(formatFeed(feed));

  return { success: true, feed };
}

/**
 * Collect data from various sources (AmikoNet, Moltbook) or import from file
 */
async function cmdGraphCollect(options) {
  const importPath = options.import;

  // Import from file
  if (importPath) {
    return await cmdGraphImport(importPath, options);
  }

  // Determine source
  const source = options.source || 'amikonet';
  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;

  try {
    let result;

    if (source === 'moltbook') {
      console.error('🔍 Collecting data from Moltbook...');
      const { collectFromMoltbook, saveGraphData } = await loadLib('collector');
      result = await collectFromMoltbook({
        apiKey: options.apiKey,
        credentials: options.credentials,
        toolsPath: options.toolsPath,
        limit: options.limit,
        sort: options.sort,
        submolt: options.submolt,
        baseUrl: options.baseUrl,
        includeComments: options.includeComments,
        commentsLimit: options.commentsLimit,
        includeSubmolts: options.includeSubmolts,
        includeTags: options.includeTags
      });
      await saveGraphData(result.posts, result.nodes, result.edges, socialPath);
    } else {
      console.error('🔍 Collecting data from AmikoNet...');
      const { collectFromAmikoNet, saveGraphData } = await loadLib('collector');
      result = await collectFromAmikoNet({ limit: options.limit });
      await saveGraphData(result.posts, result.nodes, result.edges, socialPath);
    }

    // Update metadata
    const { updateCollection, updateGraphStats } = await import('./lib/metadata.js');
    await updateCollection(source, socialPath);
    await updateGraphStats(result.nodes.length, result.edges.length, socialPath);

    console.error(`✅ Collected ${result.nodes.length} agents, ${result.edges.length} relationships`);
    console.error(`   Source: ${source}`);
    console.error(`   Saved to ${socialPath}/`);

    return { success: true, ...result };

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (source === 'amikonet') {
      console.error(`💡 Tip: Use --import <path> to load from JSON/CSV file instead`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Import graph data from JSON/CSV file (fallback for data collection)
 */
async function cmdGraphImport(importPath, options) {
  console.error(`📥 Importing data from ${importPath}...`);

  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  await fs.mkdir(socialPath, { recursive: true });

  try {
    const ext = path.extname(importPath).toLowerCase();
    let nodes = [];
    let edges = [];
    let posts = [];

    if (ext === '.json') {
      // Import from JSON
      const content = await fs.readFile(importPath, 'utf-8');
      const data = JSON.parse(content);

      // Support different JSON structures
      if (Array.isArray(data)) {
        // Array of agents/posts
        nodes = data.map(item => ({
          id: item.did || item.id || `import-${Math.random().toString(36).substr(2, 9)}`,
          name: item.name || 'Unknown',
          handle: item.handle || `@${item.name?.replace(/\s/g, '').toLowerCase() || 'unknown'}`,
          did: item.did || item.id,
          privacy: 'graph'
        }));
      } else if (data.agents) {
        // Agents format with optional edges
        nodes = data.agents;
        edges = data.edges || [];
      } else if (data.nodes && data.edges) {
        // Graph format
        nodes = data.nodes;
        edges = data.edges;
      }

      posts = data.posts || [];
    } else if (ext === '.csv') {
      // Import from CSV (simple format: name,handle,did)
      const content = await fs.readFile(importPath, 'utf-8');
      const lines = content.split('\n').slice(1); // Skip header

      for (const line of lines) {
        const [name, handle, did] = line.split(',').map(s => s?.trim());
        if (!name) continue;

        nodes.push({
          id: did || `import-${Math.random().toString(36).substr(2, 9)}`,
          name: name,
          handle: handle || `@${name.replace(/\s/g, '').toLowerCase()}`,
          did: did || '',
          privacy: 'graph'
        });
      }
    } else {
      throw new Error(`Unsupported file type: ${ext}. Use .json or .csv`);
    }

    // Save to storage
    await fs.writeFile(
      path.join(socialPath, 'nodes.json'),
      JSON.stringify(nodes, null, 2),
      'utf-8'
    );

    await fs.writeFile(
      path.join(socialPath, 'edges.json'),
      JSON.stringify(edges, null, 2),
      'utf-8'
    );

    await fs.writeFile(
      path.join(socialPath, 'posts.json'),
      JSON.stringify(posts, null, 2),
      'utf-8'
    );

    // Update metadata
    const { updateCollection, updateGraphStats } = await import('./lib/metadata.js');
    await updateCollection('import', socialPath);
    await updateGraphStats(nodes.length, edges.length, socialPath);

    console.error(`✅ Imported ${nodes.length} agents, ${edges.length} relationships`);
    console.error(`   Saved to ${socialPath}/`);

    return { success: true, nodes, edges, posts };

  } catch (error) {
    console.error(`❌ Import error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Visualize graph
 */
async function cmdGraphVisualize(options) {
  console.error('🎨 Generating graph visualization...');

  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;

  // Read graph data
  const nodesData = await fs.readFile(path.join(socialPath, 'nodes.json'), 'utf-8').catch(() => '[]');
  const edgesData = await fs.readFile(path.join(socialPath, 'edges.json'), 'utf-8').catch(() => '[]');

  const nodes = JSON.parse(nodesData);
  const edges = JSON.parse(edgesData);

  if (nodes.length === 0) {
    console.error('❌ No graph data. Run: social graph collect first');
    return { success: false, error: 'No graph data' };
  }

  // Generate HTML visualization with D3.js
  const html = generateGraphHTML(nodes, edges);
  const vizPath = path.join(socialPath, 'viz', 'graph.html');

  await fs.mkdir(path.join(socialPath, 'viz'), { recursive: true });
  await fs.writeFile(vizPath, html, 'utf-8');

  console.error(`✅ Graph saved to ${vizPath}`);
  console.error(`   Open in browser: file://${vizPath}`);
  console.error(`   Nodes: ${nodes.length}, Edges: ${edges.length}`);

  return { success: true, vizPath };
}

/**
 * Generate D3.js graph HTML
 */
function generateGraphHTML(nodes, edges) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Agent Social Graph</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0a0a0a; color: #e0e0e0; }
    #graph { width: 100vw; height: 100vh; }
    .node { cursor: pointer; }
    .node circle { stroke: #333; stroke-width: 1px; }
    .node text { font-size: 10px; fill: #e0e0e0; pointer-events: none; }
    .link { stroke: #444; stroke-opacity: 0.6; }
    .tooltip { position: absolute; padding: 8px 12px; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
    .panel { position: absolute; top: 12px; left: 12px; background: rgba(20,20,20,0.9); border: 1px solid #333; border-radius: 8px; padding: 12px; width: 280px; }
    .panel h3 { margin: 0 0 8px 0; font-size: 14px; }
    .panel label { display: block; font-size: 12px; margin-top: 8px; }
    .panel input[type="text"] { width: 100%; padding: 6px; background: #101010; color: #e0e0e0; border: 1px solid #333; border-radius: 4px; }
    .panel input[type="range"] { width: 100%; }
    .legend { margin-top: 10px; font-size: 12px; }
    .legend span { display: inline-block; margin-right: 8px; }
    .btn { margin-top: 10px; padding: 6px 10px; background: #1f6feb; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="panel">
    <h3>Graph Controls</h3>
    <label>Search node</label>
    <input id="search" type="text" placeholder="Type handle or id" />

    <label>Min connections: <span id="minDegreeVal">0</span></label>
    <input id="minDegree" type="range" min="0" max="10" value="0" />

    <label><input id="showTags" type="checkbox" checked /> Show tags</label>
    <label><input id="showSubmolts" type="checkbox" checked /> Show submolts</label>

    <label>Edge types</label>
    <label><input class="edgeType" type="checkbox" value="mention" checked /> Mentions</label>
    <label><input class="edgeType" type="checkbox" value="comment" checked /> Comments</label>
    <label><input class="edgeType" type="checkbox" value="tag" checked /> Tags</label>
    <label><input class="edgeType" type="checkbox" value="submolt" checked /> Submolts</label>

    <button id="exportPng" class="btn">Export PNG</button>

    <div class="legend">
      <div>Legend:</div>
      <span>● Agent</span>
      <span>■ Tag</span>
      <span>◆ Submolt</span>
    </div>
  </div>
  <div id="graph"></div>
  <div id="tooltip" class="tooltip"></div>

  <script>
    const nodes = ${JSON.stringify(nodes)};
    const rawEdges = ${JSON.stringify(edges)};

    const typeColor = {
      agent: "#4dabf7",
      tag: "#ffd43b",
      submolt: "#ff6b6b"
    };

    const getNodeType = (n) => {
      const id = n.id || n.handle || "";
      if (id.startsWith("#tag:")) return "tag";
      if (id.startsWith("#submolt:")) return "submolt";
      return "agent";
    };

    function buildLinks(selectedTypes) {
      return rawEdges
        .filter(e => selectedTypes.has(e.type || "mention"))
        .map(e => ({ source: e.from, target: e.to, type: e.type || "mention" }));
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    let links = buildLinks(new Set(["mention","comment","tag","submolt"]));

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id || d.handle).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    const svg = d3.select("#graph").append("svg")
      .attr("width", width)
      .attr("height", height);

    const link = svg.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", "link");

    const node = svg.append("g")
      .selectAll(".node")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    node.append("circle")
      .attr("r", 15)
      .attr("fill", d => {
        const t = getNodeType(d);
        return typeColor[t] || "#4dabf7";
      });

    node.append("text")
      .attr("x", 20)
      .attr("y", 5)
      .text(d => d.name || d.handle);

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("transform", d => \`translate(\${d.x},\${d.y})\`);
    });

    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d3.select(this).attr("stroke", "#fff");
    }

    function dragged(event) {
      d3.select(this).attr("stroke", null);
    }

    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0);
      d3.select(this).attr("stroke", null);
    }

    // Tooltip
    const tooltip = d3.select("#tooltip");
    node.on("mouseover", function(event, d) {
      tooltip.style("opacity", 1);
      tooltip.html(\`
        <strong>\${d.name || d.handle}</strong><br/>
        \${d.handle || ''}<br/>
        Connections: \${links.filter(l => l.source.id === d.id || l.source.handle === d.handle || l.target.id === d.id || l.target.handle === d.handle).length}
      \`)
      .style("left", (event.pageX + 10) + "px")
      .style("top", (event.pageY - 10) + "px");
    }).on("mouseout", () => {
      tooltip.style("opacity", 0);
    });

    // Controls
    const minDegreeInput = document.getElementById("minDegree");
    const minDegreeVal = document.getElementById("minDegreeVal");
    const searchInput = document.getElementById("search");
    const showTags = document.getElementById("showTags");
    const showSubmolts = document.getElementById("showSubmolts");
    const edgeTypeInputs = Array.from(document.querySelectorAll(".edgeType"));

    const degreeMap = {};
    function computeDegrees() {
      nodes.forEach(n => { degreeMap[n.id || n.handle] = 0; });
      links.forEach(l => {
        const s = l.source.id || l.source.handle || l.source;
        const t = l.target.id || l.target.handle || l.target;
        degreeMap[s] = (degreeMap[s] || 0) + 1;
        degreeMap[t] = (degreeMap[t] || 0) + 1;
      });
    }

    function refreshLinks() {
      const selectedTypes = new Set(edgeTypeInputs.filter(i => i.checked).map(i => i.value));
      links = buildLinks(selectedTypes);
      computeDegrees();

      link.data(links, d => d.source + "-" + d.target).join(
        enter => enter.append("line").attr("class", "link"),
        update => update,
        exit => exit.remove()
      );

      simulation.force("link", d3.forceLink(links).id(d => d.id || d.handle).distance(100));
      simulation.alpha(0.5).restart();
      applyFilters();
    }

    function applyFilters() {
      const minDegree = parseInt(minDegreeInput.value, 10);
      minDegreeVal.textContent = minDegree;
      const query = searchInput.value.trim().toLowerCase();

      node.style("display", d => {
        const t = getNodeType(d);
        if (t === "tag" && !showTags.checked) return "none";
        if (t === "submolt" && !showSubmolts.checked) return "none";
        const key = d.id || d.handle;
        if ((degreeMap[key] || 0) < minDegree) return "none";
        if (query && !(String(d.name || d.handle || "").toLowerCase().includes(query))) return "none";
        return "block";
      });

      link.style("display", l => {
        const s = l.source.id || l.source.handle || l.source;
        const t = l.target.id || l.target.handle || l.target;
        if ((degreeMap[s] || 0) < minDegree) return "none";
        if ((degreeMap[t] || 0) < minDegree) return "none";
        return "block";
      });
    }

    minDegreeInput.addEventListener("input", applyFilters);
    searchInput.addEventListener("input", applyFilters);
    showTags.addEventListener("change", applyFilters);
    showSubmolts.addEventListener("change", applyFilters);
    edgeTypeInputs.forEach(i => i.addEventListener("change", refreshLinks));

    // Export PNG
    document.getElementById("exportPng").addEventListener("click", () => {
      const serializer = new XMLSerializer();
      const svgNode = svg.node();
      const svgString = serializer.serializeToString(svgNode);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const pngUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = "graph.png";
        a.click();
      };
      img.src = url;
    });

    computeDegrees();
    applyFilters();

    window.addEventListener("resize", () => {
      svg.attr("width", window.innerWidth).attr("height", window.innerHeight);
      simulation.force("center", d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2));
      simulation.alpha(0.3).restart();
    });
  </script>
</body>
</html>`;
}

/**
 * Graph query: network neighbors (k-hop)
 */
async function cmdGraphNetwork(options) {
  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  const node = options.node;
  const hops = options.hops ? parseInt(options.hops, 10) : 1;

  if (!node) {
    console.error('❌ Missing --node. Example: social graph network --node @momo --hops 2');
    return { success: false };
  }

  const { getNeighbors } = await loadLib('graph-engine');
  const result = await getNeighbors({ socialPath, node, hops });

  console.error(`✅ Network for ${result.startKey} (${hops}-hop)`);
  console.error(`   Nodes: ${result.nodes.length}, Edges: ${result.edges.length}`);
  return { success: true, ...result };
}

/**
 * Graph query: shortest path
 */
async function cmdGraphPath(options) {
  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  const from = options.from;
  const to = options.to;

  if (!from || !to) {
    console.error('❌ Missing --from or --to. Example: social graph path --from @a --to @b');
    return { success: false };
  }

  const { shortestPath } = await loadLib('graph-engine');
  const result = await shortestPath({ socialPath, from, to });

  if (!result.path.length) {
    console.error(`⚠️  No path found between ${result.fromKey} and ${result.toKey}`);
    return { success: true, ...result };
  }

  console.error(`✅ Path (${result.path.length - 1} hops): ${result.path.join(' -> ')}`);
  return { success: true, ...result };
}

/**
 * Graph query: common neighbors
 */
async function cmdGraphCommon(options) {
  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  const a = options.a;
  const b = options.b;

  if (!a || !b) {
    console.error('❌ Missing --a or --b. Example: social graph common --a @a --b @b');
    return { success: false };
  }

  const { commonNeighbors } = await loadLib('graph-engine');
  const result = await commonNeighbors({ socialPath, a, b });

  console.error(`✅ Common neighbors (${result.common.length}):`);
  if (result.common.length) {
    console.error(`   ${result.common.join(', ')}`);
  }

  return { success: true, ...result };
}

/**
 * Graph query: centrality metrics
 */
async function cmdGraphCentrality(options) {
  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  const metric = options.metric || 'pagerank';
  const top = options.top ? parseInt(options.top, 10) : 10;

  const { degreeCentrality, pageRank, betweennessCentrality } = await loadLib('centrality');
  let scores = {};

  if (metric === 'degree') {
    scores = await degreeCentrality({ socialPath });
  } else if (metric === 'betweenness') {
    scores = await betweennessCentrality({ socialPath });
  } else {
    scores = await pageRank({ socialPath });
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, top);
  console.error(`✅ Centrality (${metric}) top ${top}:`);
  for (const [node, score] of sorted) {
    console.error(`   ${node}: ${score.toFixed ? score.toFixed(4) : score}`);
  }

  return { success: true, metric, top, results: sorted };
}

/**
 * Graph query: communities
 */
async function cmdGraphCommunities(options) {
  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;
  const iterations = options.iterations ? parseInt(options.iterations, 10) : 10;

  const { labelPropagation } = await loadLib('communities');
  const labels = await labelPropagation({ socialPath, iterations });

  const groups = {};
  for (const [node, label] of Object.entries(labels)) {
    if (!groups[label]) groups[label] = [];
    groups[label].push(node);
  }

  console.error(`✅ Communities found: ${Object.keys(groups).length}`);
  Object.entries(groups).slice(0, 10).forEach(([label, members]) => {
    console.error(`   ${label}: ${members.length} members`);
  });

  return { success: true, communities: groups };
}
/**
 * Show status
 */
async function cmdStatus(options) {
  console.error('📊 Social OS Status\n');

  const socialPath = options.socialPath || DEFAULT_SOCIAL_PATH;

  // Load and display metadata summary
  const { getMetadataSummary } = await import('./lib/metadata.js');
  const summary = await getMetadataSummary(socialPath);

  console.error(`⏱️  Timeline:`);
  console.error(`   Baseline: ${summary.baseline}`);
  console.error(`   Collection: ${summary.collection}`);
  console.error(`   Graph: ${summary.graph}`);
  console.error(`   Feed: ${summary.feed}`);

  // Baseline details
  try {
    const baseline = await fs.readFile(path.join(socialPath, 'baseline.json'), 'utf-8').then(JSON.parse);
    console.error(`\n✅ Baseline: ${baseline.identity.name} ${baseline.identity.emoji}`);
    console.error(`   Strengths: ${baseline.capabilities.core_strengths.join(', ')}`);
    console.error(`   Skills: ${baseline.capabilities.skills.slice(0, 5).join(', ')}`);
  } catch {
    console.error('\n⚠️  No baseline found. Run: social baseline');
  }

  // Check auth (skip if source is moltbook/import)
  if (summary.source === 'moltbook' || summary.source === 'import') {
    console.error(`\n🔐 AmikoNet: Skipped (source: ${summary.source})`);
  } else {
    try {
      await fs.readFile(TOKEN_FILE, 'utf-8');
      console.error('\n🔐 AmikoNet: Authenticated');
    } catch {
      console.error('\n⚠️  AmikoNet: Not authenticated');
    }
  }

  return { success: true };
}

/**
 * Main entry point
 */
async function main() {
  const { command, options, positional } = parseArgs();

  if (!command || command === '--help' || command === '-h') {
    console.error(`
🌐 Social OS CLI - Social Operating System for AI Agents

Usage: social <command> [options]

Commands:
  baseline              Generate your baseline profile
  feed                  Get your smart feed
  graph collect         Collect data from network (default: amikonet)
  graph network         Show k-hop network around a node
  graph path            Show shortest path between two nodes
  graph common          Show common neighbors between two nodes
  graph centrality      Show centrality scores
  graph communities     Detect communities
  graph visualize       View the social graph
  status                Show current status with metadata

Options:
  --name <name>         Agent name
  --handle <handle>     AmikoNet handle
  --did <did>           Agent DID
  --memory-days <n>     Days of memory to include

  --source <source>     Data source: amikonet (default) | moltbook | import
  --limit <n>           Limit results (for collect)
  --sort <sort>         Sort order: new | top (for moltbook)
  --submolt <name>      Filter by submolt (for moltbook)
  --include-comments    Include comment edges (moltbook)
  --comments-limit <n>  Max comments per post (moltbook)
  --include-submolts    Include submolt edges (moltbook)
  --include-tags        Include hashtag edges (moltbook)

  --import <path>       Import graph data from JSON/CSV file
  --api-key <key>       API key (for moltbook)
  --credentials <path>  Credentials file (for moltbook)
  --tools-path <path>   Path to TOOLS.md (for moltbook)

  --clawd-path <path>   Path to clawd directory
  --social-path <path>  Path to social directory

Privacy Levels:
  public                Full profile visible
  graph                 Only visible in network (default)
  private               Hidden from network

Examples:
  social baseline
  social feed

  # AmikoNet (default)
  social graph collect --limit 100

  # Moltbook
  social graph collect --source moltbook --limit 50 --sort new
  social graph collect --source moltbook --tools-path ~/clawd-work/TOOLS.md

  # Import from file
  social graph collect --import data.json

  # Visualization
  social graph visualize
  social graph network --node @momo --hops 2
  social graph path --from @a --to @b
  social graph common --a @a --b @b
  social graph centrality --metric pagerank --top 10
  social graph communities --iterations 10
  social status
`);
    process.exit(command ? 0 : 1);
  }

  try {
    let result;
    switch (command) {
      case 'baseline':
        result = await cmdBaseline(options);
        break;
      case 'feed':
        result = await cmdFeed(options);
        break;
      case 'graph':
        const subCommand = positional[0];
        if (subCommand === 'collect') {
          result = await cmdGraphCollect(options);
        } else if (subCommand === 'network') {
          result = await cmdGraphNetwork(options);
        } else if (subCommand === 'path') {
          result = await cmdGraphPath(options);
        } else if (subCommand === 'common') {
          result = await cmdGraphCommon(options);
        } else if (subCommand === 'centrality') {
          result = await cmdGraphCentrality(options);
        } else if (subCommand === 'communities') {
          result = await cmdGraphCommunities(options);
        } else if (subCommand === 'visualize' || subCommand === 'viz') {
          result = await cmdGraphVisualize(options);
        } else {
          console.error(`Unknown graph command: ${subCommand}`);
          process.exit(1);
        }
        break;
      case 'status':
        result = await cmdStatus(options);
        break;
      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('Run "social --help" for usage');
        process.exit(1);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
