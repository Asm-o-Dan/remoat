<p align="center" style="margin-bottom:0">
  <img src="docs/images/owl-logo.svg" alt="Remoat owl" width="240" />
</p>
<h1 align="center" style="margin-top:0">Remoat — Mobile-First Antigravity Controller</h1>

<p align="center">
  <strong>Control Antigravity IDE from anywhere — right from your phone via Telegram.</strong>
</p>

<p align="center">
  <a href="https://github.com/Asm-o-Dan/remoat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Asm-o-Dan/remoat?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/UX-Mobile--First-blueviolet?style=flat-square" alt="Mobile-First UX" />
  <img src="https://img.shields.io/badge/security-hardened-success?style=flat-square" alt="Security Hardened" />
</p>

---

## 🌟 What is Remoat?

**Remoat** is a local Telegram bot bridge for [Antigravity](https://antigravity.dev) IDE. It enables full remote operation of your home/office development environment directly from your smartphone, tablet, or secondary machine with frictionless **Mobile-First UX** and **Chrome DevTools Protocol (CDP)** integration.

Everything executes **100% locally** on your machine — no third-party cloud relay, no telemetry leaks, and zero vendor lock-in.

---

## 🚀 Key Features & Enhancements

### 📱 1. Mobile-First Workspace & Session Management
- **Interactive Chat Switcher (`/chats` & `/sessions`)**: Paginated list of active conversations with 1-click switching inline buttons.
- **Fast Chat Creator (`/new`)**: Start a new chat within the current bound project instantly.
- **Chat Summarizer (`/summary`, `/recap`, `/brief`)**: Generate immediate status briefings and milestone recaps on the go.
- **Agent Skills Catalog (`/skills`, `/skill`)**: Interactive catalog of specialized subagent workflows (`Debug Detective`, `Multi-Critic Review`, `Diagram Architect`, `Project Planner`, `Iterative Dev Loop`, etc.) with one-click triggers.
- **Dynamic Window Switcher (`/workspaces`)**: Jump between multiple open Antigravity IDE windows on the fly.

### 🛡️ 2. Security Hardening (P0 / P1 Multi-Critic Certified)
- **Safe File Downloads**: Automatic detection of generated files with smart inline `[📁 download]` buttons, backed by strict file system path validation to prevent unauthorized/arbitrary file exfiltration.
- **Workspace Session Isolation**: Complete prevention of Cross-Workspace Hijacking when switching between multiple concurrent repositories.
- **Memory & Callback Safety**: LRU caching for callback IDs prevents Telegram API 64-byte payload truncation crashes and eliminates memory leaks.

### ⚡ 3. Clean Output & Performance Optimization
- **Zero Artifact Noise**: Filters out raw internal metadata, `task.md` scratchpads, and execution logs from cluttering mobile chats.
- **Optimized CDP DOM Polling**: High-performance debouncing prevents Chromium freezes and CPU spikes.
- **Pre-formatted Code & Tables**: Formats markdown tables into readable ASCII blocks and preserves syntax-highlighted code blocks seamlessly in Telegram HTML mode.
- **🇷🇺 Russian & English Localization**: Native Telegram command menu registration in Russian (`ru`) and English with clear emoji markers.

---

## 📋 Commands Quick Reference

| Command | Description |
| :--- | :--- |
| `/chats`, `/sessions` | 💬 List project chats with 5-per-page interactive pagination |
| `/new` | ➕ Create and switch to a new chat in the current project |
| `/skills` | 🚀 Interactive catalog of agent skills and tools |
| `/summary` | 📋 Quick status report and summary of the current session |
| `/quota` | 📊 Real-time LLM quotas, model limits, and reset timers |
| `/models` | 🧠 Switch active model (Gemini 3.7 Pro, Flash, Claude, etc.) |
| `/workspaces` | 🪟 Switch active IDE window |
| `/project` | 📁 Select or switch active project directory |
| `/mode` | ⚙️ Switch execution mode (Fast / Planning / Coding) |
| `/screenshot` | 📸 Capture a real-time screenshot of the IDE window |
| `/stop` | 🛑 Safely interrupt active AI generation |
| `/autoaccept` | ⚡ Toggle auto-approval mode for tool execution |
| `/chat` | ℹ️ Detailed information about the current chat session |
| `/status` | 🔍 Diagnostic overview of bot connections and workspaces |
| `/ping` | 🏓 Check round-trip latency |
| `/help` | ❓ Complete documentation and help guide |

---

## 🛠️ Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Antigravity](https://antigravity.dev) installed
- A Telegram account

### 2. Installation
```bash
git clone https://github.com/Asm-o-Dan/remoat.git
cd remoat
npm install
npm run build
```

### 3. Configuration
Copy the `.env.template` to `.env` and fill in your details:
```bash
cp .env.template .env
```
Edit `.env`:
```env
TELEGRAM_BOT_TOKEN=your_token_from_botfather
ALLOWED_USER_IDS=your_telegram_user_id
WORKSPACE_DIR=C:\path\to\your\projects
EXTRACTION_MODE=dom-structured
```

### 4. Launch Antigravity in CDP Mode
On Windows:
```bash
open_antigravity_debug.bat
```
Or via CLI:
```bash
node dist/bin/cli.js open
```

### 5. Start the Bot
```bash
start_telegram_remote.bat
```
Or via CLI:
```bash
npm run start:built
```

Open your Telegram bot, send `/start`, and enjoy controlling your IDE from your smartphone! 📱✨

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph Mobile ["📱 Smartphone (Telegram Client)"]
        User["User Prompt / Voice / Commands"]
    end

    subgraph Bot ["🤖 Remoat Bot Bridge (Node.js / Grammy)"]
        Router["Message Parser & Router"]
        SkillsUI["Interactive Skills & Chat UI"]
        Sanitizer["Security & File Path Validator"]
        DOMExtractor["DOM Structured Extractor"]
    end

    subgraph IDE ["💻 Antigravity IDE (Electron / CDP)"]
        CDP["Chrome DevTools Protocol (Port 9000+)"]
        Cascade["AI Agent / Cascade Engine"]
        FileSystem["Local Project Files & Tools"]
    end

    User <-->|Telegram MTProto API| Bot
    Bot <-->|WebSocket JSON-RPC (CDP)| CDP
    CDP <--> Cascade
    Cascade <--> FileSystem
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Original upstream project by [optimistengineer/Remoat](https://github.com/optimistengineer/Remoat). Enhanced and maintained by [Asm-o-Dan](https://github.com/Asm-o-Dan).
