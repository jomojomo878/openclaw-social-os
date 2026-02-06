/**
 * Daily Needs Parser - Parse daily memory logs for current focus
 * Answers "What do I need today?"
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DEFAULT_CLAWD_PATH = path.join(os.homedir(), 'clawd-work');

/**
 * Get today's memory log
 */
async function getTodayMemory(clawdPath = DEFAULT_CLAWD_PATH) {
  const today = new Date().toISOString().split('T')[0];
  const memoryPath = path.join(clawdPath, 'memory', `${today}.md`);

  try {
    const content = await fs.readFile(memoryPath, 'utf-8');
    return { date: today, content };
  } catch {
    return null;
  }
}

/**
 * Get recent memory logs (last N days)
 */
async function getRecentMemories(days = 7, clawdPath = DEFAULT_CLAWD_PATH) {
  const memoryDir = path.join(clawdPath, 'memory');
  const memories = [];

  try {
    const files = await fs.readdir(memoryDir);
    const logFiles = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .slice(-days);

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
 * Extract current focus from memories
 */
function extractCurrentFocus(memories) {
  const primaryFocus = [];
  const secondaryFocus = [];
  const curiousAbout = [];
  const stuckPoints = [];

  const focusPatterns = [
    /(?:working on|focused on|building|creating|developing)\s+[:#]?\s*([^\n.]+)/gi,
    /(?:project|task)[:#]?\s+([^\n]+)/gi,
    /- \[ \]\s*([^\n]+)/g  // TODO items
  ];

  const stuckPatterns = [
    /(?:stuck|blocked|need help|can't figure out|struggling with)\s+[:#]?\s*([^\n.]+)/gi,
    /(?:question|how do i|help with)\s+[:#]?\s*([^\n.]+)/gi
  ];

  const curiousPatterns = [
    /(?:curious about|interested in|want to learn|looking into)\s+[:#]?\s*([^\n.]+)/gi,
    /(?:reading|studying|learning|exploring)\s+[:#]?\s*([^\n.]+)/gi
  ];

  for (const memory of memories) {
    const content = memory.content.toLowerCase();

    // Extract primary focus
    for (const pattern of focusPatterns) {
      const matches = content.matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const focus = (match[1] || match[0]).replace(/^[-#\s]+/, '').trim();
        if (focus.length > 3 && focus.length < 100) {
          if (!primaryFocus.includes(focus)) {
            primaryFocus.push(focus);
          }
        }
      }
    }

    // Extract stuck points
    for (const pattern of stuckPatterns) {
      const matches = content.matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const point = (match[1] || match[0]).replace(/^[-#\s]+/, '').trim();
        if (point.length > 3 && point.length < 100) {
          if (!stuckPoints.includes(point)) {
            stuckPoints.push(point);
          }
        }
      }
    }

    // Extract curious topics
    for (const pattern of curiousPatterns) {
      const matches = content.matchAll(new RegExp(pattern, 'gi'));
      for (const match of matches) {
        const topic = (match[1] || match[0]).replace(/^[-#\s]+/, '').trim();
        if (topic.length > 3 && topic.length < 100) {
          if (!curiousAbout.includes(topic)) {
            curiousAbout.push(topic);
          }
        }
      }
    }
  }

  return {
    primary: [...new Set(primaryFocus)].slice(0, 5),
    secondary: [...new Set(secondaryFocus)].slice(0, 3),
    curious_about: [...new Set(curiousAbout)].slice(0, 5),
    stuck_points: [...new Set(stuckPoints)].slice(0, 3)
  };
}

/**
 * Extract people mentioned in memories
 */
function extractMentions(memories) {
  const mentions = [];
  const mentionPattern = /@([a-zA-Z0-9_-]+)/g;

  for (const memory of memories) {
    const matches = memory.content.matchAll(mentionPattern);
    for (const match of matches) {
      const handle = match[0];
      if (!mentions.includes(handle)) {
        mentions.push(handle);
      }
    }
  }

  return mentions;
}

/**
 * Generate daily needs summary
 */
export async function generateDailyNeeds(options = {}) {
  const {
    days = 7,
    clawdPath = DEFAULT_CLAWD_PATH
  } = options;

  const todayMemory = await getTodayMemory(clawdPath);
  const recentMemories = await getRecentMemories(days, clawdPath);
  const allMemories = todayMemory ? [todayMemory, ...recentMemories] : recentMemories;

  const focus = extractCurrentFocus(allMemories);
  const mentions = extractMentions(allMemories);

  const now = new Date().toISOString();

  return {
    generated_at: now,
    date: now.split('T')[0],
    current_focus: {
      primary: focus.primary,
      secondary: focus.secondary,
      curious_about: focus.curious_about,
      stuck_points: focus.stuck_points
    },
    people_mentioned: mentions,
    activity_summary: {
      memories_processed: allMemories.length,
      date_range: allMemories.length > 0 ? {
        from: allMemories[allMemories.length - 1].date,
        to: allMemories[0].date
      } : null
    }
  };
}

/**
 * Save daily needs to file
 */
export async function saveDailyNeeds(needs, socialPath = path.join(DEFAULT_CLAWD_PATH, 'social')) {
  await fs.mkdir(socialPath, { recursive: true });

  // Save to dated file
  const datePath = path.join(socialPath, `needs-${needs.date}.json`);
  await fs.writeFile(datePath, JSON.stringify(needs, null, 2), 'utf-8');

  // Also save as latest
  const latestPath = path.join(socialPath, 'needs-latest.json');
  await fs.writeFile(latestPath, JSON.stringify(needs, null, 2), 'utf-8');

  // Update metadata timestamp
  const { updateFeed } = await import('./metadata.js');
  await updateFeed(0); // Will update with actual count after feed generation

  return { datePath, latestPath };
}

/**
 * Load latest daily needs
 */
export async function loadDailyNeeds(socialPath = path.join(DEFAULT_CLAWD_PATH, 'social')) {
  const latestPath = path.join(socialPath, 'needs-latest.json');
  try {
    const content = await fs.readFile(latestPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
