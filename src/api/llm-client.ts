import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

type Provider = "anthropic" | "openai" | "grok" | "groq";

const PROVIDER_KEYS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  grok: "GROK_API_KEY",
  groq: "GROQ_API_KEY",
};

const PROVIDER_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  grok: "grok-2-latest",
  groq: "llama-3.3-70b-versatile",
};

const AUTO_DETECT_ORDER: Provider[] = ["anthropic", "openai", "grok", "groq"];

function readKey(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function resolveProvider(): { provider: Provider; apiKey: string } {
  const requested = process.env.OWL_PROVIDER?.trim().toLowerCase();
  if (requested) {
    if (!(requested in PROVIDER_KEYS)) {
      throw new Error(
        `Invalid OWL_PROVIDER "${requested}". Must be one of: anthropic, openai, grok, groq.`
      );
    }
    const provider = requested as Provider;
    const apiKey = readKey(PROVIDER_KEYS[provider]);
    if (!apiKey) {
      throw new Error(
        `OWL_PROVIDER is set to "${provider}" but ${PROVIDER_KEYS[provider]} is not set.`
      );
    }
    return { provider, apiKey };
  }

  for (const provider of AUTO_DETECT_ORDER) {
    const apiKey = readKey(PROVIDER_KEYS[provider]);
    if (apiKey) return { provider, apiKey };
  }

  throw new Error(
    "No LLM key configured. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GROK_API_KEY, or GROQ_API_KEY in your environment, or set OWL_PROVIDER explicitly."
  );
}

function makeOpenAICompatibleClient(provider: Provider, apiKey: string): OpenAI {
  if (provider === "grok") {
    return new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1" });
  }
  if (provider === "groq") {
    return new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  }
  return new OpenAI({ apiKey });
}

/**
 * Embed text using OpenAI text-embedding-3-small.
 * Embeddings are only supported via OpenAI; warns to stderr if no OpenAI key is set.
 */
export async function embed(text: string): Promise<number[]> {
  const apiKey = readKey("OPENAI_API_KEY");
  if (!apiKey) {
    process.stderr.write(
      "[owl] embeddings require OPENAI_API_KEY (only OpenAI is supported for embeddings); skipping.\n"
    );
    return [];
  }
  try {
    const client = new OpenAI({ apiKey });
    const res = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    const vec = res.data[0]?.embedding;
    return Array.isArray(vec) ? vec : [];
  } catch (err) {
    process.stderr.write(
      `[owl] embedding request failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return [];
  }
}

export async function complete(
  systemPrompt: string,
  userContent: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.3;
  const { provider, apiKey } = resolveProvider();
  const model = PROVIDER_MODELS[provider];

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  const client = makeOpenAICompatibleClient(provider, apiKey);
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: maxTokens,
    temperature,
  });
  return res.choices[0]?.message?.content ?? "";
}

export async function completeStream(
  systemPrompt: string,
  userContent: string,
  onChunk: (chunk: string) => void,
  options?: { maxTokens?: number; temperature?: number }
): Promise<void> {
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.3;
  const { provider, apiKey } = resolveProvider();
  const model = PROVIDER_MODELS[provider];

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey });
    const stream = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      stream: true,
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        onChunk(event.delta.text);
      }
    }
    return;
  }

  const client = makeOpenAICompatibleClient(provider, apiKey);
  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: maxTokens,
    temperature,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) onChunk(delta);
  }
}
