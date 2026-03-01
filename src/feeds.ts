import type { PollGroup } from './config.ts';

export interface FeedConfig {
  name: string;
  url: string;
  group: PollGroup;
}

export const FEEDS: FeedConfig[] = [
  // Primary — poll every 60s
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', group: 'primary' },
  { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/home.xml', group: 'primary' },
  { name: 'Google News', url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', group: 'primary' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', group: 'primary' },
  { name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/main', group: 'primary' },

  // Secondary — poll every 5 minutes
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', group: 'secondary' },
  { name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', group: 'secondary' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', group: 'secondary' },
  { name: 'France 24', url: 'https://www.france24.com/en/rss', group: 'secondary' },

  // Lemmy — poll every 5 minutes
  { name: 'Lemmy World News', url: 'https://lemmy.world/feeds/c/worldnews.xml?sort=New', group: 'lemmy' },
];
