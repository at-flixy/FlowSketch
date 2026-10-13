# Contributing to FlowSketch

Forks, fixes, experiments and documentation improvements are welcome. Start with the [README](README.md), [build guide](docs/GETTING_STARTED.md), [architecture](docs/ARCHITECTURE.md) and [roadmap](ROADMAP.md). The current application targets Windows x64 and a documented educational subset of C++17.

## A practical contribution workflow

1. Choose a roadmap task or open an issue describing a concrete problem. For semantic changes, include a minimal C++ function and the expected transitions.
2. Fork the repository, create a branch and implement a focused change.
3. Run the checks appropriate to the affected component. Include commands, results and remaining limitations in the pull request.
4. Update documentation and the roadmap when the behavior or acceptance status changes.

Use English or Russian in issues and pull requests. Keep dependency lockfiles and preserve third-party license notices. Contributions are provided under the existing license applicable to the files you change; do not copy material without a compatible license and attribution.

## Checks

| Change | Required evidence |
| --- | --- |
| Shared scene, layout or SVG | `npm run typecheck`, `npm test`, `npm run build`; inspect a relevant exported diagram |
| Analyzer or semantic mapping | Build the sidecar, run `node native/analyzer/tests/run.mjs`; add positive and unsupported cases plus independently expected transitions |
| Rust host or file protocol | `pwsh -NoProfile -File scripts/tauri.ps1 test` and `check`; test cancellation/revision behavior when relevant |
| Interface or interaction | Build/typecheck and inspect the actual Tauri window; verify keyboard behavior and applicable window sizes |
| Packaging/toolchain | Verify download hashes, notices, package manifest and launch; clean-machine results must be identified separately |

GitHub CI runs SDK-free frontend checks and Windows Rust tests. Interactive WebView2 E2E and full native toolchain acceptance are separate developer checks.

## Core invariants

- Never execute submitted C++ to generate a diagram.
- Keep AST/CFG extraction, semantic mapping, layout and export verification distinct. Successful syntax parsing is insufficient to claim semantic support.
- Layout and styling must preserve node identity, source ranges and every semantic edge. Unsupported cases must remain visible.
- Reject stale requests, results and exports after source revisions.
- Keep native process invocation bounded and use fixed executable paths with argument arrays.
- Describe historical evidence and local measurements accurately. Do not mark full v1 or clean-Windows acceptance complete from a narrower test.

See [AGENTS.md](AGENTS.md) for repository instructions used by coding assistants.
