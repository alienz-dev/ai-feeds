import { defineSource, type NexusContext } from "nexus";
import { PaperSchema, type Paper } from "./types.js";
import fs from "node:fs";
import yaml from "yaml";

const ARCTIC_SHIFT_API = "https://arctic-shift.photon-reddit.com/api/posts/search";

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
    source: "reddit",
  };
}

function loadRedditConfig(): {
  subreddits: string[];
  limit: number;
  hours_back: number;
  delay_seconds: number;
} {
  const defaults = {
    subreddits: ["MachineLearning", "LocalLLaMA", "artificial"],
    limit: 100,
    hours_back: 24,
    delay_seconds: 0.5,
  };

  try {
    const content = fs.readFileSync("config.yaml", "utf-8");
    const raw = yaml.parse(content);
    const cfg = raw?.sources?.reddit;
    if (!cfg) return defaults;
    return {
      subreddits: cfg.subreddits ?? defaults.subreddits,
      limit: cfg.limit ?? defaults.limit,
      hours_back: cfg.hours_back ?? defaults.hours_back,
      delay_seconds: cfg.delay_seconds ?? defaults.delay_seconds,
    };
  } catch {
    return defaults;
  }
}

async function fetchSubreddit(
  subreddit: string,
  limit: number,
  after: number,
  logger: NexusContext["logger"]
): Promise<Paper[]> {
  const params = new URLSearchParams({
    subreddit,
    limit: String(limit),
    after: String(after),
    sort: "desc",
    sort_type: "created_utc",
    fields: "id,title,selftext,author,subreddit,url,created_utc,score,num_comments,link_flair_text",
  });

  const url = `${ARCTIC_SHIFT_API}?${params}`;
  logger.debug(`[reddit] fetching r/${subreddit} from Arctic Shift`);

  const response = await fetch(url, {
    headers: { "User-Agent": "ai-feeds/0.1 (Reddit collector)" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json() as { data: ArcticShiftPost[] };
  const posts = result.data ?? [];
  logger.debug(`[reddit] got ${posts.length} posts from r/${subreddit}`);

  return posts.map(postToPaper);
}

export const redditSource = defineSource({
  name: "reddit",
  schema: PaperSchema,
  fetch: async (ctx: NexusContext, _since?: string): Promise<Paper[]> => {
    try {
      const config = loadRedditConfig();
      const after = Math.floor(Date.now() / 1000) - config.hours_back * 3600;

      ctx.logger.info(`Fetching Reddit posts from: ${config.subreddits.join(", ")}`);

      const allPapers: Paper[] = [];

      for (let i = 0; i < config.subreddits.length; i++) {
        if (i > 0) {
          await new Promise(r => setTimeout(r, config.delay_seconds * 1000));
        }

        const sub = config.subreddits[i];
        try {
          const papers = await fetchSubreddit(sub, config.limit, after, ctx.logger);
          allPapers.push(...papers);
          ctx.logger.debug(`[reddit] got ${papers.length} posts from r/${sub}`);
        } catch (err) {
          ctx.logger.warn(`[reddit] failed to fetch r/${sub}: ${err}`);
        }
      }

      // Dedup by ID
      const seen = new Set<string>();
      const deduped: Paper[] = [];
      for (const paper of allPapers) {
        if (!seen.has(paper.id)) {
          seen.add(paper.id);
          deduped.push(paper);
        }
      }

      ctx.logger.info(`[reddit] collected ${deduped.length} posts`);
      return deduped;
    } catch (err) {
      ctx.logger.error(`[reddit] fetch failed: ${err}`);
      return [];
    }
  },
});
