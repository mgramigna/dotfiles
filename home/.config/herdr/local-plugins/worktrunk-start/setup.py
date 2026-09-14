"""Bridge Herdr creation events to approved Worktrunk hooks when available."""
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    if os.environ.get("HERDR_PLUGIN_EVENT") != "worktree.created":
        return
    # GUI/service-launched Herdr servers may not inherit interactive shell PATH.
    user_bins = [Path.home() / suffix for suffix in (".local/bin", ".cargo/bin", ".bun/bin")]
    os.environ["PATH"] = os.pathsep.join([
        os.environ.get("PATH", os.defpath),
        *(str(path) for path in user_bins if path.is_dir()),
    ])
    wt = shutil.which("wt")
    if wt is None:
        print("Skipping setup: wt is not installed", flush=True)
        return
    context = json.loads(os.environ["HERDR_PLUGIN_CONTEXT_JSON"])
    checkout = Path(context["worktree"]["checkout_path"])
    if not (checkout / ".config/wt.toml").is_file():
        print(f"Skipping setup: no .config/wt.toml in {checkout}", flush=True)
        return
    print(f"Running Worktrunk pre-start hooks in {checkout}", flush=True)
    # No --yes: changed/unapproved project commands must not run unattended.
    subprocess.run(
        [wt, "-C", str(checkout), "hook", "pre-start"],
        stdin=subprocess.DEVNULL, check=True,
    )
    print("Worktrunk setup complete", flush=True)


if __name__ == "__main__":
    main()
