/**
 * Reddit client — fetches posts from Arctic Shift API.
 *
 * Uses the public Arctic Shift API at https://arctic-shift.photon-reddit.com
 * No authentication or Chrome required.
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

const ARCTIC_SHIFT_API = "https://arctic-shift.photon-reddit.com/api/posts/search";

export interface RedditClientConfig {
  limit: number;
  hoursBack: number;
  delaySeconds: number;
}

interface ArcticShiftPost {
  id: string;
  title: string;
  selftext?: string;
  author: string;
  subreddit: string;
  url: string;
  permalink?: string;
  created_utc: number;
  score: number;
  num_comments: number;
  link_flair_text?: string;
}

function postToPaper(post: ArcticShiftPost): Paper {
  const created = new Date(post.created_utc * 1000).toISOString();
  const permalink = post.permalink
    ? (post.permalink.startsWith("http") ? post.permalink : `https://www.reddit.com${post.permalink}`)
    : `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}/`;

  return {
    id: post.id,
    title: post.title.replace(/\s+/g, " ").trim(),
    abstract: post.selftext || "",
    url: permalink,
    pdf_url: "",
    authors: [post.author || "unknown"],
    categories: [post.subreddit || "reddit"],
    primary_category: post.subreddit || "reddit",
    published: created,
    updated: created,
  };
}

export class RedditClient {
  private limit: number;
  private hoursBack: number;
  private delaySeconds: number;

  constructor(config: RedditClientConfig) {
    this.limit = config.limit;
    this.hoursBack = config.hoursBack;
    this.delaySeconds = config.delaySeconds;
  }

  /**
   * Fetch posts from multiple subreddits via Arctic Shift API.
   */
  async fetchMultipleSubreddits(
    subreddits: string[],
    _sort: string,
    _limit: number
  ): Promise<Paper[]> {
    const after = Math.floor(Date.now() / 1000) - this.hoursBack * 3600;
    const allPapers: Paper[] = [];

    for (let i = 0; i < subreddits.length; i++) {
      if (i > 0) {
        await new Promise(r => setTimeout(r, this.delaySeconds * 1000));
      }

      const sub = subreddits[i];
      try {
        const papers = await this.fetchSubreddit(sub, after);
        allPapers.push(...papers);
        log.debug(`Got ${papers.length} posts from r/${sub}`);
      } catch (err) {
        log.warn(`Failed to fetch r/${sub}: ${err}`);
      }
    }

    return allPapers;
  }

  private async fetchSubreddit(subreddit: string, after: number): Promise<Paper[]> {
    const params = new URLSearchParams({
      subreddit,
      limit: String(this.limit),
      after: String(after),
      sort: "desc",
      sort_type: "created_utc",
      fields: "id,title,selftext,author,subreddit,url,created_utc,score,num_comments,link_flair_text",
    });

    const url = `${ARCTIC_SHIFT_API}?${params}`;
    log.debug(`Fetching r/${subreddit} from Arctic Shift`);

    const response = await fetch(url, {
      headers: { "User-Agent": "ai-feeds/0.1 (Reddit collector)" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as { data: ArcticShiftPost[] };
    const posts = result.data ?? [];
    return posts.map(postToPaper);
  }
}
