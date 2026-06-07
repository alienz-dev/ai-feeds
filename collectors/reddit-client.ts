/**
 * Reddit CDP client — scrapes Reddit pages via Chrome DevTools Protocol.
 *
 * Connects to an existing Chrome instance via CDP, navigates to Reddit
 * subreddit pages, and extracts post data from the DOM using shreddit-post
 * web component attributes.
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

export interface RedditClientConfig {
  delaySeconds: number;
  timeoutSeconds: number;
  cdpEndpoint: string;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** Raw post data extracted from the DOM */
interface RawRedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  permalink: string;
  url: string;
  created_utc: string; // ISO timestamp from DOM
  score: number;
  num_comments: number;
}

/**
 * Parse a raw Reddit post (from DOM extraction) into the Paper interface.
 */
export function parseRedditPost(post: RawRedditPost): Paper {
  // Handle both ISO strings and Unix timestamps
  let created: string;
  if (typeof post.created_utc === "number") {
    created = new Date(post.created_utc * 1000).toISOString();
  } else {
    created = new Date(post.created_utc).toISOString();
  }

  const title = post.title.replace(/\s+/g, " ").trim();
  const url = post.permalink.startsWith("http")
    ? post.permalink
    : `https://www.reddit.com${post.permalink}`;

  return {
    id: post.id,
    title,
    abstract: post.selftext || "",
    url,
    pdf_url: "",
    authors: [post.author || "unknown"],
    categories: [post.subreddit || "reddit"],
    primary_category: post.subreddit || "reddit",
    published: created,
    updated: created,
  };
}

export class RedditClient {
  private delaySeconds: number;
  private timeoutSeconds: number;
  private cdpEndpoint: string;

  constructor(config: RedditClientConfig) {
    this.delaySeconds = config.delaySeconds;
    this.timeoutSeconds = config.timeoutSeconds;
    this.cdpEndpoint = config.cdpEndpoint;
  }

  /**
   * Fetch posts from multiple subreddits via CDP.
   * Connects to Chrome once, opens a page per subreddit, disconnects at the end.
   */
  async fetchMultipleSubreddits(
    subreddits: string[],
    sort: string,
    limit: number
  ): Promise<Paper[]> {
    // Dynamic import to avoid hard dependency when Reddit is disabled
    const { chromium } = await import("playwright");

    let browser;
    try {
      browser = await chromium.connectOverCDP(this.cdpEndpoint);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to connect to Chrome via CDP at ${this.cdpEndpoint}: ${msg}. Is Chrome running with --remote-debugging-port?`
      );
    }

    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("No browser context available");
    }

    const allPapers: Paper[] = [];

    try {
      for (let i = 0; i < subreddits.length; i++) {
        if (i > 0) {
          log.debug(`Rate limiting: waiting ${this.delaySeconds}s before next subreddit`);
          await sleep(this.delaySeconds);
        }

        const sub = subreddits[i];
        log.info(`Fetching r/${sub} (${sort}, limit=${limit})`);

        try {
          const papers = await this.scrapeSubreddit(context, sub, sort, limit);
          allPapers.push(...papers);
          log.debug(`Got ${papers.length} posts from r/${sub}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`Failed to fetch r/${sub}: ${msg}`);
        }
      }
    } finally {
      // Don't close the browser — it's the user's existing Chrome instance
      // Just disconnect cleanly
      browser.close().catch(() => {});
    }

    return allPapers;
  }

  /**
   * Scrape a single subreddit by navigating to it in Chrome and extracting
   * post data from the DOM.
   */
  private async scrapeSubreddit(
    context: import("playwright").BrowserContext,
    subreddit: string,
    sort: string,
    limit: number
  ): Promise<Paper[]> {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}/`;
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutSeconds * 1000,
      });

      // Wait for Reddit's web components to hydrate
      await page.waitForTimeout(3000);

      // Extract posts from the DOM
      const rawPosts: RawRedditPost[] = await page.evaluate((maxPosts) => {
        const posts: RawRedditPost[] = [];

        // Try shreddit-post web components first (Reddit 2024+ redesign)
        const shredditPosts = document.querySelectorAll("shreddit-post");
        if (shredditPosts.length > 0) {
          for (const el of Array.from(shredditPosts).slice(0, maxPosts)) {
            const post = el as HTMLElement;
            // post-id attr may be null; id attr has "t3_xxxxx" format
            const rawId =
              post.getAttribute("post-id") ??
              post.getAttribute("id") ??
              "";
            const id = rawId.replace(/^t3_/, "");
            const title = post.getAttribute("post-title") ?? "";
            const author = post.getAttribute("author") ?? "";
            const subreddit = post.getAttribute("subreddit-name") ?? "";
            const score = parseInt(post.getAttribute("score") ?? "0", 10);
            const numComments = parseInt(
              post.getAttribute("comment-count") ?? "0",
              10
            );
            const createdUtc =
              post.getAttribute("created-timestamp") ??
              post.getAttribute("created_utc") ??
              "";

            // Get permalink from attribute or title link
            const permalink =
              post.getAttribute("permalink") ??
              post.querySelector('a[slot="title"]')?.getAttribute("href") ??
              `/r/${subreddit}/comments/${id}/`;

            // Get URL — for link posts this is the external URL, for text posts it's the permalink
            const contentHref = post.getAttribute("content-href");
            const contentLink = post.querySelector(
              'a[slot="content-link"], faceplate-tracker a'
            );
            const postUrl =
              contentHref ??
              contentLink?.getAttribute("href") ??
              `https://www.reddit.com${permalink}`;

            // Get selftext for text posts
            const selftextEl = post.querySelector(
              '[slot="text-body"], .md'
            );
            const selftext = selftextEl?.textContent?.trim() ?? "";

            if (id && title) {
              posts.push({
                id,
                title,
                selftext,
                author,
                subreddit,
                permalink,
                url: postUrl,
                created_utc: createdUtc,
                score: isNaN(score) ? 0 : score,
                num_comments: isNaN(numComments) ? 0 : numComments,
              });
            }
          }
        } else {
          // Fallback: try article elements with data-testid
          const articles = document.querySelectorAll(
            'article[data-testid="post-container"]'
          );
          for (const el of Array.from(articles).slice(0, maxPosts)) {
            const article = el as HTMLElement;
            const titleEl = article.querySelector(
              'h2, [data-testid="post-title"]'
            );
            const title = titleEl?.textContent?.trim() ?? "";
            const linkEl = article.querySelector('a[href*="/comments/"]');
            const href = (linkEl as HTMLAnchorElement)?.href ?? "";
            const idMatch = href.match(/comments\/([a-z0-9]+)/i);
            const id = idMatch ? idMatch[1] : "";
            const author =
              article
                .querySelector('[data-testid="post_author"]')
                ?.textContent?.trim() ?? "";
            const subreddit =
              article
                .querySelector('[data-testid="subreddit-name"]')
                ?.textContent?.replace("r/", "")
                ?.trim() ?? "";

            if (id && title) {
              posts.push({
                id,
                title,
                selftext: "",
                author,
                subreddit,
                permalink: href.replace("https://www.reddit.com", ""),
                url: href,
                created_utc: new Date().toISOString(),
                score: 0,
                num_comments: 0,
              });
            }
          }
        }

        return posts;
      }, limit);

      log.debug(`Extracted ${rawPosts.length} raw posts from r/${subreddit}`);

      // Parse into Paper format
      const papers: Paper[] = [];
      for (const raw of rawPosts) {
        try {
          papers.push(parseRedditPost(raw));
        } catch (err) {
          log.warn(`Failed to parse post from r/${subreddit}: ${err}`);
        }
      }

      return papers;
    } finally {
      await page.close();
    }
  }
}
