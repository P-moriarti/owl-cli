# 🦉 owl-cli

> A privacy-first, schema-aware AI assistant for Supabase and
> PostgreSQL. Bring your own API key — your data never leaves
> your machine.

owl-cli introspects your real database schema and answers
questions about it using an LLM of your choice. It knows your
tables, columns, indexes, foreign keys, RLS policies, and
triggers — so it gives grounded answers instead of hallucinated
ones.

## Why owl?

Generic AI tools don't know your schema. owl does. It reads your
actual database structure, feeds a curated subset to the model,
and streams back expert answers — SQL queries, RLS policies,
migration files, performance advice. Your connection string is
**never sent to the LLM**. Only schema metadata is.

## Features

- 🔍 **Schema-aware** — introspects tables, columns, FKs,
  indexes, RLS policies, and triggers
- 🔒 **Privacy-first** — connection strings encrypted at rest
  with AES-256-GCM; never sent to the LLM
- 🤖 **Provider-agnostic** — works with Anthropic (Claude),
  OpenAI, Grok, or Groq
- 🧠 **Conversation memory** — remembers context within and
  across sessions
- ⚡ **Streaming answers** — responses stream directly to your
  terminal
- 🎯 **Smart retrieval** — classifies your question and fetches
  only the relevant schema context

## Requirements

- Node.js 18+
- A Supabase or PostgreSQL database
- An API key from one of: Anthropic, OpenAI, xAI (Grok), or Groq

## Installation

```bash
git clone https://github.com/P-moriarti/owl-cli.git
cd owl-cli
npm install
npm run build
npm link
```

## Quick Start

**1. Configure your API key**

```bash
cp .env.example .env
```

Edit `.env` and add the key for your preferred provider —
you only need one:

```env
ANTHROPIC_API_KEY=sk-ant-...   # Claude (recommended)
OPENAI_API_KEY=sk-...          # GPT-4o
GROK_API_KEY=xai-...           # Grok
GROQ_API_KEY=gsk_...           # Groq (Llama)
```

**2. Connect your database**

```bash
owl init
```

owl will prompt for a project name and your Postgres connection
string, validate the connection, and introspect your schema.

**3. Start asking questions**

```bash
owl ask "What indexes are missing on the orders table?"
owl ask "Write an RLS policy so users can only see their own rows"
owl ask "Why is this query slow?"
```

## Provider Selection

owl auto-detects your provider based on which key is present.
To force a specific one:

```env
OWL_PROVIDER=anthropic   # or openai | grok | groq
```

## Commands

| Command | Description |
|---|---|
| `owl init` | Connect a new database project |
| `owl ask "<question>"` | Ask owl about your database |
| `owl refresh` | Re-introspect the schema |
| `owl list` | List all configured projects |
| `owl use <slug>` | Switch active project |
| `owl history` | View conversation history |

## Security

- Connection strings encrypted at rest with **AES-256-GCM**
  and a Scrypt-derived key
- Config and cache files stored at `~/.owl/` with `chmod 600`
- **Only schema metadata is sent to the LLM** — your data and
  connection string stay on your machine
- Set `OWL_SERVER_PEPPER` for production-grade encryption strength

## Contributing

Contributions are welcome. Open an issue before submitting
a pull request.

## License

MIT
