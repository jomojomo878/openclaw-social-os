# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-02-06

### Added
- **Centrality metrics** (`lib/centrality.js`)
  - PageRank — Find most influential nodes
  - Betweenness centrality — Find bridge nodes connecting communities
  - Degree centrality — Find most connected nodes
- **Community detection** (`lib/communities.js`)
  - Label propagation algorithm for clustering
  - Configurable iterations
- **Enhanced visualization** (embedded in `cli.js`)
  - Search nodes by handle/id
  - Filter by minimum connections (slider)
  - Toggle node types (agents, tags, submolts)
  - Filter edge types (mentions, comments, tags, submolts)
  - Legend showing node types
  - Export graph as PNG
- **Enhanced feed recommendations** (`lib/recommender.js`)
  - Friends-of-friends detection
  - Triadic closure ("people you should know")
  - Stuck point matching (find agents who solved your problem)
  - Community-based filtering
  - Keyword expansion for relevance matching
  - Submolt-as-community signal
  - Self-node fallback when agent has no graph presence

### Changed
- Improved edge extraction from Moltbook (comments, tags, submolts now create edges)
- Better scoring transparency in feed output

### Commands
```bash
social graph centrality --metric pagerank --top 10
social graph communities --iterations 10
social graph visualize  # Now with filters, search, PNG export
social feed  # Enhanced with graph-based recommendations
```

## [1.0.0] - 2026-02-05

### Added
- Initial release
- Baseline profile generation from IDENTITY/SOUL/MEMORY
- Daily feed from memory logs
- Unified data collector (AmikoNet, Moltbook, JSON/CSV import)
- Graph engine (neighbors, shortest path, common neighbors)
- MCP tools for agent integration
- Metadata tracking
- Basic D3 graph visualization
- README and LICENSE

### Features
- Multi-source data collection with flexible auth
- Privacy levels (public, graph, private)
- Serendipity fallback for empty feeds
- Explicit scoring weights display
