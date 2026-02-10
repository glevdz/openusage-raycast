# OpenUsage for Raycast

Track your AI coding subscription usage directly from the Raycast menu bar.

A [Raycast](https://raycast.com) extension port of [OpenUsage](https://github.com/robinebers/openusage) by [@robinebers](https://github.com/robinebers) — the open-source AI subscription usage tracker.

## Supported Providers

| Provider | Credential Source | What's Tracked |
|----------|------------------|----------------|
| **Claude** | `~/.claude/.credentials.json` | Session (5h), Weekly (7d), Sonnet (7d), Extra usage ($) |
| **Codex** | `~/.config/codex/auth.json` or `~/.codex/auth.json` | Session (5h), Weekly (7d), Reviews, Credits |
| **Kimi** | `~/.kimi/credentials/kimi-code.json` or OS keyring | Session, Weekly |

## Commands

### AI Usage Menu Bar

Shows a summary icon and your highest usage percentage in the Raycast menu bar. Clicking it reveals a dropdown with per-provider usage lines. Auto-refreshes every 5 minutes.

### Show AI Usage

Full detail view launched from Raycast search. Shows all providers with metadata panels including plan tier, usage percentages, dollar amounts, and reset times.

## How It Works

Each provider reads credentials from its respective CLI tool's local auth files (the same files the CLI creates when you log in). No API keys or manual configuration needed — if you're logged in to Claude Code, Codex CLI, or Kimi CLI, it just works.

- **OAuth token refresh** is handled automatically when tokens expire
- **Credentials are never sent anywhere** except to the provider's own API
- **OS keyring support** for providers that store tokens in the OS credential store (Windows Credential Manager, macOS Keychain)

## Install

```bash
git clone https://github.com/glevdz/openusage-raycast.git
cd openusage-raycast
npm install
npm run dev
```

This opens the extension in Raycast dev mode. The commands will appear in Raycast search.

## Prerequisites

You must be logged in to at least one supported CLI tool:

- **Claude**: Run `claude` and complete the OAuth flow
- **Codex**: Run `codex` and complete the OAuth flow
- **Kimi**: Run `kimi login`

Providers you're not logged in to will show an error message — they won't block other providers from loading.

## Project Structure

```
src/
  menu-bar.tsx              # MenuBarExtra command (menu bar widget)
  show-usage.tsx            # List detail view command
  providers/
    types.ts                # Shared interfaces
    claude.ts               # Claude Code provider
    codex.ts                # OpenAI Codex provider
    kimi.ts                 # Kimi Code provider
    index.ts                # Provider registry
  lib/
    credentials.ts          # File + OS keyring credential reading
    oauth.ts                # Shared OAuth refresh helpers
    formatting.ts           # Display formatting utilities
    cache.ts                # Raycast Cache API wrapper
```

## Credits

This is a Raycast extension port of [OpenUsage](https://github.com/robinebers/openusage) by [Robin Ebers](https://github.com/robinebers). OpenUsage is the original open-source desktop app that tracks AI coding subscription usage across providers via a system tray panel.

## License

MIT
