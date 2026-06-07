/**
 * LLM client with provider switching and retry logic.
 */

export interface LlmProviderConfig {
  provider: "claude" | "openai" | "ollama";
  model: string;
  apiKey?: string;
}

const MAX_RETRIES = 3;

/**
 * Call an LLM provider and return the raw response text.
 * Retries on 429 (exponential backoff) and 5xx (fixed delay).
 */
export async function callLlm(
  prompt: string,
  config: LlmProviderConfig
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await makeRequest(prompt, config);

      if (response.ok) {
        return extractContent(await response.json(), config.provider);
      }

      // Rate limiting — exponential backoff
      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await sleep(delay);
        lastError = new Error(`Rate limited (429)`);
        continue;
      }

      // Server errors — fixed 2s delay
      if (response.status >= 500) {
        await sleep(2000);
        lastError = new Error(`Server error (${response.status})`);
        continue;
      }

      // Other client errors — don't retry
      throw new Error(
        `LLM API error ${response.status}: ${await response.text()}`
      );
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("LLM API error")) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  throw new Error(
    `LLM call failed after ${MAX_RETRIES} retries: ${lastError?.message}`
  );
}

async function makeRequest(
  prompt: string,
  config: LlmProviderConfig
): Promise<Response> {
  switch (config.provider) {
    case "claude": {
      const claudeKey = config.apiKey || process.env.ANTHROPIC_API_KEY || "";
      if (!claudeKey) {
        throw new Error("ANTHROPIC_API_KEY not set. Export it or pass via config.");
      }
      return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    }

    case "openai": {
      const openaiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
      if (!openaiKey) throw new Error("OPENAI_API_KEY not set. Export it or pass --api-key.");
      return fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });
    }

    case "ollama":
      return fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          format: "json",
        }),
      });
  }
}

/**
 * Extract the text content from a provider-specific JSON response.
 */
function extractContent(data: any, provider: string): string {
  switch (provider) {
    case "claude":
      return data.content?.[0]?.text ?? "";
    case "openai":
      return data.choices?.[0]?.message?.content ?? "";
    case "ollama":
      return data.message?.content ?? "";
    default:
      return "";
  }
}

/**
 * Single LLM call with no retry logic. Used by scorePapers for batch-level error handling.
 */
export async function callLlmOnce(
  prompt: string,
  config: LlmProviderConfig
): Promise<string> {
  const response = await makeRequest(prompt, config);
  if (!response.ok) {
    throw new Error(
      `LLM API error ${response.status}: ${await response.text()}`
    );
  }
  return extractContent(await response.json(), config.provider);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
