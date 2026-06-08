/**
 * AI Signals Site Generator
 *
 * Reads scored papers from processor/output/ and generates static HTML pages:
 * - Daily digest pages (YYYY-MM-DD.html)
 * - Individual article pages (article/{slug}.html)
 * - Index page (index.html — redirects to latest)
 * - Archive page (archive.html — lists all days)
 *
 * Usage: npx tsx scripts/generate-site.ts [--date YYYY-MM-DD] [--verbose]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoredPaper {
  id: string;
  title: string;
  abstract: string;
  url: string;
  pdf_url: string;
  authors: string[];
  categories: string[];
  primary_category: string;
  published: string;
  updated: string;
  relevance_score: number;
  score_explanation: string;
}

interface ScorerResult {
  source: string;
  scored_at: string;
  interests_used: string[];
  provider: string;
  model: string;
  total_input: number;
  total_scored: number;
  total_above_threshold: number;
  warnings: string[];
  papers: ScoredPaper[];
}

interface SiteConfig {
  domain: string;
  vault_path: string;
  title: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig(): SiteConfig {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(__dirname, "..", "config.yaml");
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = yaml.parse(raw);
    return {
      domain: parsed?.site?.domain ?? "signals.mingli.world",
      vault_path: parsed?.site?.vault_path ?? "~/vault/inbox/signals",
      title: parsed?.site?.title ?? "AI Signals",
      description:
        parsed?.site?.description ??
        "Curated AI industry intelligence — papers, tools, and insights worth your time.",
    };
  } catch {
    return {
      domain: "signals.mingli.world",
      vault_path: "~/vault/inbox/signals",
      title: "AI Signals",
      description:
        "Curated AI industry intelligence — papers, tools, and insights worth your time.",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function scoreEmoji(score: number): string {
  if (score >= 9) return "🔥";
  if (score >= 8) return "⭐";
  return "📌";
}

function sourceLabel(paper: ScoredPaper): string {
  const url = paper.url;
  if (url.includes("arxiv.org")) return "arXiv";
  if (url.includes("news.ycombinator.com")) return "HN";
  if (url.includes("reddit.com")) return "Reddit";
  if (url.includes("dev.to")) return "Dev.to";
  if (url.includes("huggingface.co")) return "HuggingFace";
  if (url.includes("github.com")) return "GitHub";
  if (url.includes("producthunt.com")) return "Product Hunt";
  return paper.primary_category || "Web";
}

// ---------------------------------------------------------------------------
// HTML Templates
// ---------------------------------------------------------------------------

const CSS = `
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --accent: #58a6ff;
  --accent-hover: #79c0ff;
  --green: #3fb950;
  --orange: #d29922;
  --red: #f85149;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem;
}
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
h2 { font-size: 1.4rem; margin: 2rem 0 1rem; color: var(--text-muted); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
.meta { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem; }
.meta span { margin-right: 1rem; }
.score-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 600;
}
.score-9 { background: var(--red); color: #fff; }
.score-8 { background: var(--orange); color: #fff; }
.score-7 { background: var(--border); color: var(--text); }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
  transition: border-color 0.2s;
}
.card:hover { border-color: var(--accent); }
.card-title { font-size: 1.1rem; margin-bottom: 0.5rem; }
.card-title a { color: var(--text); }
.card-title a:hover { color: var(--accent); }
.card-explanation { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.75rem; }
.card-links { display: flex; gap: 1rem; flex-wrap: wrap; }
.card-links a { font-size: 0.85rem; }
.abstract { color: var(--text-muted); font-size: 0.9rem; margin: 1rem 0; line-height: 1.7; }
.btn {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  transition: all 0.2s;
}
.btn:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover { background: var(--accent-hover); }
.back-link { display: inline-block; margin-bottom: 1.5rem; font-size: 0.9rem; }
.archive-list { list-style: none; }
.archive-list li { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
.archive-list li:last-child { border-bottom: none; }
.archive-list a { font-size: 1rem; }
.archive-count { color: var(--text-muted); font-size: 0.85rem; margin-left: 0.5rem; }
.toast {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  background: var(--green);
  color: #fff;
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  font-size: 0.9rem;
  opacity: 0;
  transform: translateY(1rem);
  transition: all 0.3s;
  z-index: 1000;
}
.toast.show { opacity: 1; transform: translateY(0); }
nav { display: flex; gap: 1.5rem; margin-bottom: 2rem; font-size: 0.9rem; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.8rem; text-align: center; }
`;

function baseLayout(
  title: string,
  content: string,
  config: SiteConfig,
  canonicalPath: string = ""
): string {
  const canonical = canonicalPath
    ? `https://${config.domain}${canonicalPath}`
    : `https://${config.domain}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${config.title}</title>
  <meta name="description" content="${escapeHtml(config.description)}">
  <link rel="canonical" href="${canonical}">
  <style>${CSS}</style>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/archive.html">Archive</a>
  </nav>
  ${content}
  <footer>
    <p>Generated by <a href="https://github.com/alienz-dev/ai-feeds">AI Feeds</a> · Updated daily</p>
  </footer>
  <div id="toast" class="toast"></div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Page Generators
// ---------------------------------------------------------------------------

function generateArticlePage(
  paper: ScoredPaper,
  date: string,
  config: SiteConfig
): string {
  const slug = titleToSlug(paper.title);
  const authors = paper.authors.join(", ");
  const categories = paper.categories.join(", ");
  const source = sourceLabel(paper);
  const scoreClass =
    paper.relevance_score >= 9
      ? "score-9"
      : paper.relevance_score >= 8
        ? "score-8"
        : "score-7";

  // Generate Obsidian vault markdown
  const vaultSlug = titleToSlug(paper.title);
  const vaultFile = `inbox/signals/${date}-${vaultSlug}`;
  const tags = paper.categories.map((c) => c.replace(".", "-")).join(", ");
  const vaultMarkdown = `---
title: "${paper.title.replace(/"/g, '\\"')}"
source: ${source.toLowerCase()}
url: ${paper.url}
pdf_url: ${paper.pdf_url}
score: ${paper.relevance_score}
date: ${date}
authors: [${paper.authors.map((a) => `"${a}"`).join(", ")}]
tags: [ai-signal, ${tags}]
status: inbox
---

# ${paper.title}

## Why This Matters
${paper.score_explanation}

## Abstract
${paper.abstract || "No abstract available."}

## Source
- Original: ${paper.url}
${paper.pdf_url ? `- PDF: ${paper.pdf_url}` : ""}
- Score: ${paper.relevance_score}/10
- Captured: ${date}
`;

  // Build Obsidian URI (opens Obsidian and creates the note)
  const obsidianUri = `obsidian://new?vault=vault&file=${encodeURIComponent(vaultFile)}&content=${encodeURIComponent(vaultMarkdown)}`;

  const content = `
  <a href="/${date}.html" class="back-link">← Back to ${date} digest</a>

  <article>
    <h1>${escapeHtml(paper.title)}</h1>

    <div class="meta">
      <span class="score-badge ${scoreClass}">${paper.relevance_score}/10</span>
      <span>${source}</span>
      <span>${formatDate(paper.published)}</span>
    </div>

    <div class="card">
      <h3>Why This Matters</h3>
      <p class="card-explanation">${escapeHtml(paper.score_explanation)}</p>
    </div>

    ${
      paper.abstract
        ? `
    <h2>Abstract</h2>
    <p class="abstract">${escapeHtml(paper.abstract)}</p>
    `
        : ""
    }

    <h2>Links</h2>
    <div class="card-links">
      <a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener">📄 Original</a>
      ${
        paper.pdf_url
          ? `<a href="${escapeHtml(paper.pdf_url)}" target="_blank" rel="noopener">📥 PDF</a>`
          : ""
      }
    </div>

    <h2>Metadata</h2>
    <div class="meta">
      <p><strong>Authors:</strong> ${escapeHtml(authors)}</p>
      <p><strong>Categories:</strong> ${escapeHtml(categories)}</p>
      <p><strong>Published:</strong> ${formatDate(paper.published)}</p>
    </div>

    <h2>Save to Vault</h2>
    <p style="margin-bottom: 1rem; color: var(--text-muted);">
      Save this article directly to your Obsidian vault. Opens Obsidian with the note pre-filled.
    </p>
    <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
      <a href="${obsidianUri}" class="btn btn-primary" id="saveBtn">
        📋 Save to Obsidian Vault
      </a>
      <button class="btn" onclick="copyMarkdown()">
        📎 Copy Markdown
      </button>
    </div>
    <p style="margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-muted);">
      Will save to: <code>vault/${vaultFile}.md</code>
    </p>
  </article>

  <script>
    const vaultMarkdown = ${JSON.stringify(vaultMarkdown)};

    async function copyMarkdown() {
      try {
        await navigator.clipboard.writeText(vaultMarkdown);
        showToast('✅ Markdown copied to clipboard');
      } catch (e) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = vaultMarkdown;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('✅ Markdown copied to clipboard');
      }
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
  </script>`;

  return baseLayout(
    paper.title,
    content,
    config,
    `/article/${slug}.html`
  );
}

function generateDailyPage(
  date: string,
  papers: ScoredPaper[],
  config: SiteConfig
): string {
  const high = papers.filter((p) => p.relevance_score >= 9);
  const medium = papers.filter(
    (p) => p.relevance_score >= 8 && p.relevance_score < 9
  );
  const low = papers.filter(
    (p) => p.relevance_score >= 7 && p.relevance_score < 8
  );

  function renderCard(paper: ScoredPaper): string {
    const slug = titleToSlug(paper.title);
    const source = sourceLabel(paper);
    const scoreClass =
      paper.relevance_score >= 9
        ? "score-9"
        : paper.relevance_score >= 8
          ? "score-8"
          : "score-7";

    return `
    <div class="card">
      <div class="card-title">
        <a href="/article/${slug}.html">${escapeHtml(paper.title)}</a>
      </div>
      <div class="meta">
        <span class="score-badge ${scoreClass}">${paper.relevance_score}/10</span>
        <span>${source}</span>
      </div>
      <p class="card-explanation">${escapeHtml(truncate(paper.score_explanation, 200))}</p>
      <div class="card-links">
        <a href="/article/${slug}.html">Read more →</a>
        <a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener">Original</a>
      </div>
    </div>`;
  }

  let content = `
  <h1>${formatDate(date)}</h1>
  <p class="meta">${papers.length} signals collected · ${high.length + medium.length} high relevance</p>

  ${
    high.length > 0
      ? `
  <h2>🔥 Top Picks (9/10)</h2>
  ${high.map(renderCard).join("\n")}
  `
      : ""
  }

  ${
    medium.length > 0
      ? `
  <h2>⭐ Worth Reading (8/10)</h2>
  ${medium.map(renderCard).join("\n")}
  `
      : ""
  }

  ${
    low.length > 0
      ? `
  <h2>📌 Also Noted (7/10)</h2>
  <ul class="archive-list">
    ${low
      .map(
        (p) => `
    <li>
      <a href="/article/${titleToSlug(p.title)}.html">${escapeHtml(p.title)}</a>
      <span class="archive-count">${sourceLabel(p)}</span>
    </li>`
      )
      .join("\n")}
  </ul>
  `
      : ""
  }`;

  return baseLayout(`${date} — AI Signals`, content, config, `/${date}.html`);
}

function generateIndexPage(
  latestDate: string,
  dates: string[],
  config: SiteConfig
): string {
  const content = `
  <h1>${config.title}</h1>
  <p style="color: var(--text-muted); margin-bottom: 2rem;">${config.description}</p>

  <h2>Latest Digest</h2>
  <div class="card">
    <div class="card-title">
      <a href="/${latestDate}.html">${formatDate(latestDate)}</a>
    </div>
    <p class="card-explanation">Today's curated AI signals — papers, tools, and insights.</p>
    <div class="card-links">
      <a href="/${latestDate}.html">View digest →</a>
    </div>
  </div>

  <h2>Recent Days</h2>
  <ul class="archive-list">
    ${dates
      .slice(0, 7)
      .map(
        (d) => `
    <li><a href="/${d}.html">${formatDate(d)}</a></li>`
      )
      .join("\n")}
  </ul>

  <p style="margin-top: 1rem;"><a href="/archive.html">View all dates →</a></p>`;

  return baseLayout(config.title, content, config, "/");
}

function generateArchivePage(
  dates: string[],
  dateCounts: Map<string, number>,
  config: SiteConfig
): string {
  const content = `
  <h1>Archive</h1>
  <p class="meta">${dates.length} days of signals</p>

  <ul class="archive-list">
    ${dates
      .map(
        (d) => `
    <li>
      <a href="/${d}.html">${formatDate(d)}</a>
      <span class="archive-count">${dateCounts.get(d) ?? 0} signals</span>
    </li>`
      )
      .join("\n")}
  </ul>`;

  return baseLayout("Archive — AI Signals", content, config, "/archive.html");
}

// ---------------------------------------------------------------------------
// Telegram Message Generator
// ---------------------------------------------------------------------------

export function generateTelegramMessage(
  date: string,
  papers: ScoredPaper[],
  config: SiteConfig
): string {
  const high = papers.filter((p) => p.relevance_score >= 9);
  const medium = papers.filter(
    (p) => p.relevance_score >= 8 && p.relevance_score < 9
  );
  const low = papers.filter(
    (p) => p.relevance_score >= 7 && p.relevance_score < 8
  );

  const lines: string[] = [];
  lines.push(`📡 AI Signals — ${date}`);
  lines.push("");

  if (high.length > 0) {
    lines.push(`🔥 TOP PICKS (${high.length})`);
    for (const p of high) {
      const slug = titleToSlug(p.title);
      const summary = truncate(p.score_explanation, 80);
      lines.push(`• ${p.title}`);
      lines.push(`  ${summary}`);
      lines.push(`  → https://${config.domain}/article/${slug}`);
      lines.push("");
    }
  }

  if (medium.length > 0) {
    lines.push(`⭐ WORTH READING (${medium.length})`);
    for (const p of medium) {
      const slug = titleToSlug(p.title);
      lines.push(`• ${p.title}`);
      lines.push(`  → https://${config.domain}/article/${slug}`);
    }
    lines.push("");
  }

  if (low.length > 0) {
    lines.push(`📌 ALSO NOTED (${low.length})`);
    lines.push(
      low
        .slice(0, 5)
        .map((p) => p.title.split(":")[0].trim())
        .join(" • ")
    );
    if (low.length > 5) {
      lines.push(`  +${low.length - 5} more`);
    }
    lines.push("");
  }

  lines.push(`🔗 Full digest: https://${config.domain}/${date}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      date: { type: "string", short: "d" },
      verbose: { type: "boolean", short: "v", default: false },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: generate-site [options]

Options:
  -h, --help         Show this help message
  -d, --date DATE    Generate for specific date (default: today)
  -v, --verbose      Enable debug logging
`);
    process.exit(0);
  }

  const config = loadConfig();
  const targetDate =
    (values.date as string) ?? new Date().toISOString().slice(0, 10);

  // Find all scored files
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outputDir = path.join(__dirname, "..", "processor", "output");
  const publicDir = path.join(__dirname, "..", "public");

  // Ensure public directory exists
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const articleDir = path.join(publicDir, "article");
  if (!fs.existsSync(articleDir)) {
    fs.mkdirSync(articleDir, { recursive: true });
  }

  // Read all scored files
  const scoredFiles = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith("scored-") && f.endsWith(".json"))
    .sort()
    .reverse(); // newest first

  if (scoredFiles.length === 0) {
    console.log("No scored files found. Run the scorer first.");
    process.exit(0);
  }

  const dateCounts = new Map<string, number>();
  const allDates: string[] = [];
  let generatedPages = 0;

  for (const file of scoredFiles) {
    // Extract date from filename: scored-YYYY-MM-DD.json
    const dateMatch = file.match(/scored-(\d{4}-\d{2}-\d{2})\.json/);
    if (!dateMatch) continue;
    const date = dateMatch[1];

    const filePath = path.join(outputDir, file);
    const data: ScorerResult = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const papers = data.papers.filter((p) => p.relevance_score >= 7);

    if (papers.length === 0) continue;

    allDates.push(date);
    dateCounts.set(date, papers.length);

    // Generate daily page
    const dailyHtml = generateDailyPage(date, papers, config);
    const dailyPath = path.join(publicDir, `${date}.html`);
    fs.writeFileSync(dailyPath, dailyHtml);
    generatedPages++;

    if (values.verbose) {
      console.log(`Generated ${date}.html (${papers.length} signals)`);
    }

    // Generate individual article pages
    for (const paper of papers) {
      const slug = titleToSlug(paper.title);
      const articleHtml = generateArticlePage(paper, date, config);
      const articlePath = path.join(articleDir, `${slug}.html`);
      fs.writeFileSync(articlePath, articleHtml);
      generatedPages++;
    }

    if (values.verbose) {
      console.log(`  → ${papers.length} article pages`);
    }

    // Generate Telegram message for target date
    if (date === targetDate) {
      const telegramMsg = generateTelegramMessage(date, papers, config);
      const telegramPath = path.join(publicDir, "telegram-message.txt");
      fs.writeFileSync(telegramPath, telegramMsg);
      if (values.verbose) {
        console.log(`  → telegram-message.txt`);
      }
    }
  }

  // Generate index page (redirects to latest)
  const latestDate = allDates[0] ?? targetDate;
  const indexHtml = generateIndexPage(latestDate, allDates, config);
  fs.writeFileSync(path.join(publicDir, "index.html"), indexHtml);
  generatedPages++;

  // Generate archive page
  const archiveHtml = generateArchivePage(allDates, dateCounts, config);
  fs.writeFileSync(path.join(publicDir, "archive.html"), archiveHtml);
  generatedPages++;

  console.log(
    `✅ Generated ${generatedPages} pages for ${allDates.length} days`
  );
  console.log(`   Output: ${publicDir}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
