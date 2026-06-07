/**
 * Product Hunt CDP client — scrapes the daily leaderboard via Chrome DevTools Protocol.
 *
 * Connects to the user's existing Chrome automation profile on port 9222.
 * No OAuth required — uses the already-logged-in browser session.
 *
 * URL pattern: https://www.producthunt.com/leaderboard/daily/{YYYY}/{M}/{D}
 */

import { log } from "./common.js";
import type { Paper } from "./common.js";

export interface ProductHuntClientConfig {
  delaySeconds: number;
  timeoutSeconds: number;
  cdpEndpoint: string;
}

interface RawProduct {
  rank: number;
  name: string;
  tagline: string;
  slug: string;
  url: string;
  topics: string[];
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function buildLeaderboardUrl(date: string): string {
  const [year, month, day] = date.split("-");
  // PH uses no-zero-padded month/day
  return `https://www.producthunt.com/leaderboard/daily/${year}/${parseInt(month, 10)}/${parseInt(day, 10)}`;
}

function parseProduct(raw: RawProduct, date: string): Paper {
  return {
    id: raw.slug,
    title: raw.name,
    abstract: raw.tagline,
    url: raw.url,
    pdf_url: "",
    authors: [],
    categories: raw.topics,
    primary_category: "producthunt",
    published: date,
    updated: date,
  };
}

export class ProductHuntClient {
  private delaySeconds: number;
  private timeoutSeconds: number;
  private cdpEndpoint: string;

  constructor(config: ProductHuntClientConfig) {
    this.delaySeconds = config.delaySeconds;
    this.timeoutSeconds = config.timeoutSeconds;
    this.cdpEndpoint = config.cdpEndpoint;
  }

  /**
   * Fetch products from the Product Hunt daily leaderboard.
   *
   * @param date - ISO date string (YYYY-MM-DD)
   * @returns Array of Paper objects mapped from PH products
   */
  async fetchProducts(date: string): Promise<Paper[]> {
    const url = buildLeaderboardUrl(date);
    log.debug(`Fetching Product Hunt leaderboard: ${url}`);

    // Dynamic import to avoid hard dependency when PH is disabled
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

    const page = await context.newPage();

    try {
      // Rate limit: wait before navigation
      await sleep(this.delaySeconds);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutSeconds * 1000,
      });

      // Wait for React hydration — product cards take time to render
      await page.waitForTimeout(3000);

      // Extract products by evaluating JavaScript in the page context
      const rawProducts: RawProduct[] = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/products/"]');
        const products: Array<{
          rank: number;
          name: string;
          tagline: string;
          slug: string;
          url: string;
          topics: string[];
        }> = [];

        const seen = new Set<string>();

        for (const link of links) {
          const text = link.textContent?.trim() ?? "";
          // Match "1. Product Name" pattern
          const rankMatch = text.match(/^(\d+)\.\s/);
          if (!rankMatch) continue;

          const rank = parseInt(rankMatch[1], 10);
          const name = text.replace(/^\d+\.\s*/, "").trim();
          const href = (link as HTMLAnchorElement).href;

          // Extract slug from URL: /products/slug-name
          const slugMatch = href.match(/\/products\/([^/?#]+)/);
          const slug = slugMatch ? slugMatch[1] : name.toLowerCase().replace(/\s+/g, "-");

          if (seen.has(slug)) continue;
          seen.add(slug);

          // Get parent element and extract tagline/topics from child nodes
          // Structure: parent > SPAN(name) > SPAN(tagline) > DIV(topics)
          let tagline = "";
          let topics: string[] = [];
          let el: HTMLElement | null = link.parentElement;
          for (let i = 0; i < 5 && el; i++) {
            const children = Array.from(el.children);
            if (children.length >= 2) {
              // Look for child that contains tagline (text after name)
              for (const child of children) {
                const childText = child.textContent?.trim() ?? "";
                if (childText === text || childText === name) continue;
                // Check if this child has bullet-separated topics
                if (/[•·‣◦⁃∙]/.test(childText)) {
                  topics = childText
                    .split(/[•·‣◦⁃∙]/)
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0);
                } else if (childText.length > 0 && !tagline) {
                  tagline = childText;
                }
              }
              if (tagline || topics.length > 0) break;
            }
            el = el.parentElement;
          }

          products.push({
            rank,
            name,
            tagline,
            slug,
            url: href,
            topics,
          });
        }

        return products;
      });

      log.info(`Scraped ${rawProducts.length} products from ${date}`);

      return rawProducts.map((raw) => parseProduct(raw, date));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to scrape Product Hunt page: ${msg}`);
    } finally {
      await page.close();
    }
  }
}
