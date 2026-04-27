/**
 * Curated catalog of popular Lucide icons exposed in the customize UI's
 * icon picker. Names match `lucide-react` 1.x exports exactly (note 1.x
 * renames: Home → House, Unlock → LockOpen, BarChart3 → ChartBar, etc.).
 *
 * Tags drive the picker's search box.
 */
export interface LucideCatalogEntry {
  name: string;
  tags: string[];
}

export const LUCIDE_CATALOG: LucideCatalogEntry[] = [
  // emotion / reaction
  { name: 'Heart',         tags: ['love', 'like', 'favorite'] },
  { name: 'Star',          tags: ['favorite', 'rating', 'award'] },
  { name: 'Smile',         tags: ['happy', 'face', 'emoji'] },
  { name: 'ThumbsUp',      tags: ['like', 'approve'] },
  { name: 'Sparkles',      tags: ['magic', 'shine', 'ai'] },
  { name: 'Flame',         tags: ['fire', 'hot', 'trending'] },
  { name: 'Zap',           tags: ['lightning', 'fast', 'energy'] },

  // achievement
  { name: 'Trophy',        tags: ['award', 'win', 'achievement'] },
  { name: 'Award',         tags: ['medal', 'prize'] },
  { name: 'Crown',         tags: ['king', 'premium', 'pro'] },
  { name: 'Gift',          tags: ['present', 'reward'] },
  { name: 'Rocket',        tags: ['launch', 'fast', 'startup'] },

  // weather / nature
  { name: 'Sun',           tags: ['light', 'day', 'weather'] },
  { name: 'Moon',          tags: ['night', 'dark', 'weather'] },
  { name: 'Cloud',         tags: ['weather', 'sky'] },

  // navigation / arrows
  { name: 'ArrowRight',    tags: ['next', 'forward'] },
  { name: 'ArrowLeft',     tags: ['back', 'previous'] },
  { name: 'ArrowUp',       tags: ['up', 'increase'] },
  { name: 'ArrowDown',     tags: ['down', 'decrease'] },
  { name: 'ChevronRight',  tags: ['next', 'expand'] },

  // media
  { name: 'Play',          tags: ['video', 'start'] },
  { name: 'Pause',         tags: ['video', 'stop'] },
  { name: 'Music',         tags: ['audio', 'sound'] },
  { name: 'Image',         tags: ['photo', 'picture'] },
  { name: 'Video',         tags: ['movie', 'film'] },
  { name: 'Camera',        tags: ['photo', 'capture'] },
  { name: 'Mic',           tags: ['microphone', 'audio'] },

  // ui basics
  { name: 'Check',         tags: ['ok', 'done', 'confirm'] },
  { name: 'X',             tags: ['close', 'cancel', 'delete'] },
  { name: 'Plus',          tags: ['add', 'new'] },
  { name: 'Minus',         tags: ['remove', 'subtract'] },
  { name: 'Settings',      tags: ['config', 'gear', 'cog'] },
  { name: 'Search',        tags: ['find', 'magnify'] },
  { name: 'Bell',          tags: ['notification', 'alert'] },

  // people / comms
  { name: 'User',          tags: ['person', 'profile'] },
  { name: 'Users',         tags: ['team', 'people', 'group'] },
  { name: 'Mail',          tags: ['email', 'message'] },
  { name: 'MessageCircle', tags: ['chat', 'comment'] },
  { name: 'Phone',         tags: ['call', 'contact'] },
  { name: 'Send',          tags: ['submit', 'message'] },
  { name: 'Share2',        tags: ['share', 'social'] },

  // commerce / data
  { name: 'ShoppingCart',  tags: ['buy', 'cart', 'shop'] },
  { name: 'CreditCard',    tags: ['pay', 'card'] },
  { name: 'DollarSign',    tags: ['money', 'price'] },
  { name: 'TrendingUp',    tags: ['growth', 'increase', 'chart'] },
  { name: 'ChartBar',      tags: ['stats', 'graph', 'analytics'] },
  { name: 'ChartPie',      tags: ['stats', 'distribution'] },
  { name: 'Activity',      tags: ['pulse', 'health'] },

  // misc
  { name: 'House',         tags: ['home', 'main'] },
  { name: 'Globe',         tags: ['world', 'web', 'internet'] },
  { name: 'MapPin',        tags: ['location', 'place'] },
  { name: 'Calendar',      tags: ['date', 'schedule'] },
  { name: 'Clock',         tags: ['time', 'duration'] },
  { name: 'Coffee',        tags: ['drink', 'break'] },
  { name: 'Lock',          tags: ['secure', 'private'] },
  { name: 'Eye',           tags: ['view', 'show'] },
  { name: 'Bookmark',      tags: ['save', 'mark'] },
  { name: 'Flag',          tags: ['report', 'mark'] },
  { name: 'Tag',           tags: ['label', 'category'] },
];

/** Default selection when a generated PARAMS block uses `// type: icon`. */
export const DEFAULT_LUCIDE_ICON = 'Star';

/**
 * Filter the catalog by a free-text query. Matches against name (case-insensitive)
 * and any tag substring. Empty query returns the full catalog.
 */
export function searchLucideCatalog(query: string): LucideCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return LUCIDE_CATALOG;
  return LUCIDE_CATALOG.filter(
    e =>
      e.name.toLowerCase().includes(q) ||
      e.tags.some(t => t.includes(q)),
  );
}
