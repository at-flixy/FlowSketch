# FlowSketch repository instructions

Read README.md, ROADMAP.md, the relevant specification in docs/reference and the most recent stage report before changing behavior. The project is a verified developer-machine Windows prototype; full v1 acceptance remains open.

- Use ROADMAP.md as the public task list. Preserve stable IDs; mark a task complete only after recording relevant reproducible evidence. Read the current Git state before updating it.
- Never execute submitted C++ to build a diagram. Use fixed tool executables and bounded argument arrays, protocol and resource controls.
- Separate parsing, AST/CFG extraction, semantic mapping, geometry and export claims. Header parsing alone does not prove library support.
- Layout and style must not modify semantic nodes/edges. Unsupported cases and stale revisions must remain explicit.
- For UI work preserve the approved graphite/periwinkle design, code/formatting modes, keyboard access and reduced motion. Follow ui-ux-pro-max when the skill is available; its absence does not prevent an independent contributor from working.
- Coordinate independent parallel edits before touching shared contracts. Prefer focused changes with meaningful checks; see CONTRIBUTING.md.
- Keep lockfiles and third-party notices. Download toolchains under tools with pinned versions and hashes; do not change permanent PATH or registry for routine setup.
- Do not claim clean-machine, full C++17, offline installer, DPI or performance acceptance without the corresponding evidence.
- Stage 1 experiments are historical references. Explain any changes needed for a regression or shared-contract fix.
- Do not introduce credentials, personal paths, private workspace links or machine-specific dependencies into public files.

Folders: src is React/scene; src-tauri is Rust host; native/analyzer is the Clang sidecar; scripts holds build/verification; tests/fixtures contains compiler-free graph regressions; docs holds specifications and evidence.
