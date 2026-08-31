# Windows setup

Two supported paths. **WSL is recommended** — you get the Linux experience,
and Claude/Cursor/Codex CLIs run best there.

## Option A — WSL 2 (recommended)

1. `wsl --install` (PowerShell as admin), open Ubuntu.
2. Install Node ≥ 20 (`sudo apt install nodejs npm` or nvm) and git.
3. Install the provider CLIs *inside WSL* (`npm i -g @anthropic-ai/claude-code`,
   `curl https://cursor.com/install -fsS | bash`, `npm i -g @openai/codex`)
   and log in to each once.
4. Clone and set up:
   ```bash
   git clone <repo> mordomo-os && cd mordomo-os
   scripts/setup.sh
   mordomo start
   ```
5. Open http://127.0.0.1:4777 in your Windows browser (WSL forwards localhost).
6. Autostart: inside WSL use `mordomo service install` (systemd --user);
   enable systemd in `/etc/wsl.conf` if needed (`[boot] systemd=true`).

Keep the repository and your indexed folders inside the WSL filesystem
(`~/…`) — indexing across `/mnt/c` works but is slower.

## Option B — native Windows (PowerShell)

1. Install Node ≥ 20 (winget: `winget install OpenJS.NodeJS.LTS`) and git.
2. Install the provider CLIs you use and log in once.
3. ```powershell
   git clone <repo> mordomo-os; cd mordomo-os
   scripts/setup.ps1        # npm install + build + guided setup
   npx mordomo start
   ```
4. Autostart: `npx mordomo service install` registers a Task Scheduler logon
   task (the script is shown and confirmed first).

Notes for native Windows:

- MordomoOS never uses symlinks — provider exports are managed copies, so
  everything works on NTFS without developer mode.
- `better-sqlite3` ships prebuilt binaries for Node LTS on Windows; if your
  Node version has none, install the VS Build Tools or switch to WSL.
- Read-only enforcement depends on each provider CLI's Windows behaviour;
  `mordomo doctor` probes the installed flags and reports what is available.
