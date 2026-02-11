# .openclaw Viewer

**Browse your [OpenClaw](https://openclaw.ai) `.openclaw` directory from your phone.**

A lightweight, self-hosted file viewer built for one problem: OpenClaw agents generate tons of files locally — memory logs, war room blueprints, agent configs, daily notes, project specs — and you need a fast way to browse and read them from any device without pushing anything to the cloud.

**What's local stays local.** No sync. No cloud storage. No third-party access to your files. Just a tiny Node.js server on your machine, accessed securely over [Tailscale](https://tailscale.com).

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
  <img src="assets/screenshot-mobile.jpg" alt=".openclaw Viewer on mobile" width="320">
</p>

## Why?

If you run [OpenClaw](https://github.com/openclaw/openclaw) (or any AI agent framework), you end up with a `.openclaw` directory full of files:

- 🧠 **Memory files** — daily logs, long-term memory, structured learnings
- ⚔️ **War room outputs** — architecture specs, blueprints, decision logs
- 🤖 **Agent configs** — SOUL.md, AGENTS.md, IDENTITY.md per agent
- 📋 **Project docs** — specs, plans, research reports, copy drafts

Opening these one-by-one in a terminal or editor is painful, especially from your phone. Pushing them to GitHub/Notion/cloud defeats the purpose of local-first AI agents.

**.openclaw Viewer** gives you a clean, mobile-optimized interface to browse the entire file structure and read any markdown file — all served from your own machine.

## Features

- 📁 **Two view modes** — folder list view and expandable tree view (toggle persisted)
- 🔍 **File search** — search by filename across all directories
- 📱 **Mobile-first** — designed for phone screens, works great on desktop too
- 🌙 **Dark theme** — GitHub-dark inspired, easy on the eyes
- 💡 **Syntax highlighting** — code blocks highlighted via highlight.js
- 🍞 **Breadcrumb navigation** — always know where you are, tap to navigate back
- 🔒 **Secure** — HTML sanitized with DOMPurify, directory traversal protection, Tailscale for network security
- ⚡ **Zero build step** — just `node server.js`, ~33MB memory footprint
- 🏠 **Local-only** — your files never leave your machine

## Prerequisites

- **Node.js 18+**
- **[Tailscale](https://tailscale.com)** — install on both your host machine and phone, connect to the same tailnet

## Quick Start

```bash
git clone https://github.com/bowen0110/.openclaw viewer.git
cd .openclaw viewer
npm install
npm start
```

Opens at **http://localhost:3500**

From your phone (via Tailscale): **http://\<your-tailscale-hostname\>:3500**

### Custom directory and port

```bash
# Serve your .openclaw directory
WORKSPACE_ROOT=~/.openclaw npm start

# Change port
PORT=8080 npm start

# Both
WORKSPACE_ROOT=~/my-notes PORT=8080 npm start
```

### Find your Tailscale hostname

```bash
tailscale status
# Then access from any device on your tailnet:
# http://<hostname>:3500
```

## Long-Running Setup

You want this always running so you can access it anytime from your phone.

### Linux / WSL2 (systemd) — Recommended

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/.openclaw viewer.service << EOF
[Unit]
Description=.openclaw Viewer
After=network.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=/path/to/.openclaw viewer
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=PORT=3500
Environment=WORKSPACE_ROOT=/path/to/.openclaw
MemoryMax=256M
TimeoutStartSec=15
WatchdogSec=120

[Install]
WantedBy=default.target
EOF

# Enable, start, and persist across logouts
systemctl --user daemon-reload
systemctl --user enable .openclaw viewer
systemctl --user start .openclaw viewer
loginctl enable-linger $USER
```

**Built-in crash protection:**
- Max 5 restarts in 5 minutes, then stops (no infinite loops)
- Memory capped at 256MB
- Kills hung processes after 2 minutes

```bash
# Useful commands
systemctl --user status .openclaw viewer
systemctl --user restart .openclaw viewer
journalctl --user -u .openclaw viewer -f
```

### macOS (launchd)

```bash
cat > ~/Library/LaunchAgents/com..openclaw viewer.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com..openclaw viewer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/.openclaw viewer/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>3500</string>
    <key>WORKSPACE_ROOT</key>
    <string>/path/to/your/workspace</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/tmp/.openclaw viewer.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/.openclaw viewer.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com..openclaw viewer.plist
```

### Windows

**Option A: Task Scheduler**

1. Open `taskschd.msc`
2. Create Task → Name: ".openclaw Viewer"
3. Trigger: "At startup"
4. Action: Start `node`, arguments `server.js`, start in `C:\path\to\.openclaw viewer`
5. Settings: Restart every 1 minute on failure, up to 5 times

**Option B: PM2 (cross-platform)**

```bash
npm install -g pm2
pm2 start server.js --name .openclaw viewer
pm2 startup   # auto-start on boot
pm2 save
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3500` | Server port |
| `WORKSPACE_ROOT` | Parent directory of `server.js` | Root directory to serve files from |

## API

| Endpoint | Description |
|----------|-------------|
| `GET /` | Web UI |
| `GET /api/tree` | JSON directory tree of all `.md` files |
| `GET /api/file?path=<path>` | Rendered HTML + raw content |
| `GET /api/search?q=<query>` | Filename search (max 30 results) |

## Works with any file directory

While built for OpenClaw, this works with any directory of files — Obsidian vaults, documentation repos, note collections, Zettelkasten, etc.

## Tech Stack

- [Express](https://expressjs.com/) — HTTP server
- [Marked](https://marked.js.org/) — Markdown rendering
- [highlight.js](https://highlightjs.org/) — Syntax highlighting
- [DOMPurify](https://github.com/cure53/DOMPurify) — HTML sanitization

## License

MIT
