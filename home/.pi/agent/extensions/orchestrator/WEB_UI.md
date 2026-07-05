# Orchestrator web UI

A tiny local web server for starting `/orchestrate` runs without opening the Pi TUI.

## Run manually

```sh
ORCHESTRATOR_REPO=/path/to/repo \
ORCHESTRATOR_HOST=0.0.0.0 \
ORCHESTRATOR_PORT=8787 \
npx tsx /home/mg/.pi/agent/extensions/orchestrator/web-server.ts
```

Open `http://host:8787`.

## Run with systemd user service

The dotfiles include:

- `~/.config/systemd/user/pi-orchestrator-web.service`
- `~/.config/pi-orchestrator-web/env`

Edit the env file first, especially `ORCHESTRATOR_REPO` and `ORCHESTRATOR_HOST`. The included `PATH` mirrors the important entries from `~/.zshrc` plus `~/.cargo/bin`, so systemd can find `bun`, `gh`, `wt`, `pi`, `npx`, etc.

```sh
systemctl --user daemon-reload
systemctl --user enable --now pi-orchestrator-web.service
systemctl --user status pi-orchestrator-web.service
journalctl --user -u pi-orchestrator-web.service -f
```

To let the service keep running after logout:

```sh
sudo loginctl enable-linger "$USER"
```

## Behavior

- Only one orchestration run is allowed at a time.
- Web-triggered runs are always fresh:
  - the main worktree is switched to the GitHub default branch,
  - `git fetch origin` is run,
  - the branch is reset hard to `origin/<default>` ,
  - the previous `.orchestrator/runs/prd-<issue>` directory is removed.
- PRD picker loads open GitHub issues matching `PRD in:title,body`.
- You can also paste an issue URL, `#123`, or `123` into the text box.

The server assumes `gh`, `git`, `wt`, and `pi` are already authenticated/configured for the user running it.
