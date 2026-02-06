/**
 * Baseline Generator - Generate agent profile from IDENTITY/SOUL/MEMORY
 * Answers "Who am I?" and "What am I good at?"
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DEFAULT_CLAWD_PATH = path.join(os.homedir(), 'clawd-work');

/**
 * Parse IDENTITY.md for basic info
 */
async function parseIdentity(clawdPath = DEFAULT_CLAWD_PATH) {
  const identityPath = path.join(clawdPath, 'IDENTITY.md');
  try {
    const content = await fs.readFile(identityPath, 'utf-8');
    const identity = {
      name: 'Unknown',
      creature: 'AI companion',
      emoji: '🤖',
      avatar: 'AI creature'
    };

    const nameMatch = content.match(/-?\s*\*?\*?Name:\*?\*?\s*([^\n]+)/i);
    if (nameMatch) identity.name = nameMatch[1].trim();

    const creatureMatch = content.match(/-?\s*\*?\*?Creature:\*?\*?\s*([^\n]+)/i);
    if (creatureMatch) identity.creature = creatureMatch[1].trim();

    const emojiMatch = content.match(/-?\s*\*?\*?Emoji:\*?\*?\s*([^\s]+)/i);
    if (emojiMatch) identity.emoji = emojiMatch[1].trim();

    const avatarMatch = content.match(/-?\s*\*?\*?Avatar:\*?\*?\s*([^\n]+)/i);
    if (avatarMatch) identity.avatar = avatarMatch[1].trim();

    return identity;
  } catch {
    return {
      name: 'Unknown',
      creature: 'AI companion',
      emoji: '🤖',
      avatar: 'AI creature'
    };
  }
}

/**
 * Parse SOUL.md for personality and values
 */
async function parseSoul(clawdPath = DEFAULT_CLAWD_PATH) {
  const soulPath = path.join(clawdPath, 'SOUL.md');
  try {
    const content = await fs.readFile(soulPath, 'utf-8');
    const result = {
      personality: {
        communication_style: 'friendly',
        social_orientation: 'balanced',
        collaboration_style: 'open'
      },
      values: {
        core: [],
        interests: [],
        dealbreakers: []
      }
    };

    // Extract core truths
    const coreSection = content.match(/## Core Truths\n([\s\S]+?)(?=##|$)/i);
    if (coreSection) {
      const truths = coreSection[1].split('\n')
        .map(line => line.replace(/^[\s\-*]*\*\*/g, '').replace(/\*\*$/g, '').trim())
        .filter(line => line.length > 10);
      result.values.core = truths;
    }

    // Extract vibe/communication style
    if (content.toLowerCase().includes('direct')) {
      result.personality.communication_style = 'direct and concise';
      result.personality.collaboration_style = 'task-focused';
    } else if (content.toLowerCase().includes('warm') || content.toLowerCase().includes('friendly')) {
      result.personality.communication_style = 'warm and conversational';
      result.personality.collaboration_style = 'relationship-focused';
    }

    // Social orientation
    if (content.toLowerCase().includes('quality over quantity')) {
      result.personality.social_orientation = 'quality over quantity';
    }

    return result;
  } catch {
    return {
      personality: {
        communication_style: 'friendly',
        social_orientation: 'balanced',
        collaboration_style: 'open'
      },
      values: {
        core: [],
        interests: [],
        dealbreakers: []
      }
    };
  }
}

/**
 * Get recent memories to extract skills and interests
 */
async function getRecentMemories(daysBack = 30, clawdPath = DEFAULT_CLAWD_PATH) {
  const memoryDir = path.join(clawdPath, 'memory');
  const memories = [];

  try {
    const files = await fs.readdir(memoryDir);
    const logFiles = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .slice(-daysBack);

    for (const file of logFiles) {
      try {
        const content = await fs.readFile(path.join(memoryDir, file), 'utf-8');
        memories.push({ date: file.replace('.md', ''), content });
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return memories;
}

/**
 * Extract skills and interests from memories
 */
function extractSkillsAndInterests(memories) {
  const skills = new Set();
  const interests = new Set();
  const topics = new Set();

  const skillPatterns = [
    /(?:working on|learning|studying|building|created|built)\s+([A-Z][a-zA-Z]+)/g,
    /(?:skill|capable|good at|expert in)\s+:?\s*([A-Z][a-zA-Z]+)/gi,
    /#(\w+)/g
  ];

  for (const memory of memories) {
    const content = memory.content.toLowerCase();

    // Tech/interest keywords
    const techKeywords = [
      'solana', 'rust', 'python', 'javascript', 'ai', 'machine learning',
      'trading', 'defi', 'smart contracts', 'security', 'react', 'node.js',
      'writing', 'research', 'design', 'product'
    ];

    for (const keyword of techKeywords) {
      if (content.includes(keyword)) {
        if (['rust', 'python', 'javascript', 'solana'].includes(keyword)) {
          skills.add(keyword);
        } else {
          interests.add(keyword);
        }
      }
    }

    // Extract patterns
    for (const pattern of skillPatterns) {
      const matches = content.matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const term = (match[1] || match[0]).replace(/^#/, '');
        if (term.length > 2 && term.length < 30) {
          topics.add(term);
        }
      }
    }
  }

  return {
    skills: Array.from(skills),
    interests: Array.from(interests),
    topics: Array.from(topics)
  };
}

/**
 * Generate baseline profile
 */
export async function generateBaseline(options = {}) {
  const {
    agentDid = process.env.AGENT_DID || '',
    agentName = 'Jojo',
    amikonetHandle = process.env.AMIKONET_HANDLE || '',
    clawdPath = DEFAULT_CLAWD_PATH,
    memoryDays = 30
  } = options;

  const [identity, soul, memories] = await Promise.all([
    parseIdentity(clawdPath),
    parseSoul(clawdPath),
    getRecentMemories(memoryDays, clawdPath)
  ]);

  const { skills, interests, topics } = extractSkillsAndInterests(memories);

  // Infer core strengths from soul values
  const coreStrengths = [];
  if (soul.values.core.some(v => v.toLowerCase().includes('helpful'))) {
    coreStrengths.push('helpful');
  }
  if (soul.values.core.some(v => v.toLowerCase().includes('opinion'))) {
    coreStrengths.push('independent thinker');
  }
  if (soul.values.core.some(v => v.toLowerCase().includes('resourceful'))) {
    coreStrengths.push('resourceful');
  }
  if (soul.values.core.some(v => v.toLowerCase().includes('creative'))) {
    coreStrengths.push('creative');
  }

  // Add inferred strengths from activities
  if (skills.includes('writing') || topics.includes('writing')) {
    coreStrengths.push('writing');
  }
  if (skills.includes('trading') || topics.includes('trading')) {
    coreStrengths.push('analysis');
  }

  const now = new Date().toISOString();

  const baseline = {
    version: '1.0.0',
    generated_at: now,
    last_refreshed: now,
    agent: {
      id: 'personal',
      name: agentName,
      did: agentDid,
      amikonet_handle: amikonetHandle
    },
    identity: {
      name: identity.name || agentName,
      creature: identity.creature,
      emoji: identity.emoji,
      avatar: identity.avatar
    },
    capabilities: {
      core_strengths: [...new Set(coreStrengths)],
      skills: [...new Set([...skills, ...interests])],
      interests: [...new Set([...interests, ...topics])],
      learning: [] // Can be manually updated
    },
    personality: {
      communication_style: soul.personality.communication_style,
      social_orientation: soul.personality.social_orientation,
      collaboration_style: soul.personality.collaboration_style
    },
    current_focus: {
      primary: [],
      secondary: [],
      curious_about: []
    },
    activity_summary: {
      memory_span: {
        days: memories.length,
        from: memories[0]?.date,
        to: memories[memories.length - 1]?.date
      },
      total_activities: memories.length
    }
  };

  return baseline;
}

/**
 * Save baseline to file
 */
export async function saveBaseline(baseline, socialPath = path.join(DEFAULT_CLAWD_PATH, 'social')) {
  await fs.mkdir(socialPath, { recursive: true });
  const baselinePath = path.join(socialPath, 'baseline.json');
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2), 'utf-8');

  // Update metadata timestamp
  const { updateBaseline } = await import('./metadata.js');
  await updateBaseline();

  return baselinePath;
}

/**
 * Load baseline from file
 */
export async function loadBaseline(socialPath = path.join(DEFAULT_CLAWD_PATH, 'social')) {
  const baselinePath = path.join(socialPath, 'baseline.json');
  try {
    const content = await fs.readFile(baselinePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
