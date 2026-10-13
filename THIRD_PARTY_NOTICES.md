# FlowSketch third-party notices

Original FlowSketch source code, tests, documentation and project-specific artwork are licensed under the MIT License in LICENSE, except where a file states otherwise. Third-party code, fonts, headers, license texts and other copied upstream materials retain their respective upstream licenses. The FlowSketch MIT License does not relicense those materials.

This prototype embeds a Tauri 2 / React / Monaco interface and ELK + fontkit scene renderer. It distributes a static Clang LibTooling analyzer and the fixed LLVM-MinGW header trees. It does not distribute the Clang SDK, Rust toolchain, Node.js, or the experiment's PDFKit/resvg runtime.

Exact JavaScript versions and integrity values are in package-lock.json; exact Rust versions and checksums are in src-tauri/Cargo.lock. Upstream source references are preserved by these lockfiles and the toolchain manifests. License texts for the shipped header distributions and static analyzer are copied to notices. The fonts are unmodified: Liberation Sans, IBM Plex Sans, JetBrains Mono; the respective SIL OFL texts are retained.

| Component | License / source |
| --- | --- |
| Tauri, Tauri dialog plugin | MIT OR Apache-2.0; https://github.com/tauri-apps/tauri |
| React / React DOM | MIT; https://github.com/facebook/react |
| Monaco Editor | MIT; https://github.com/microsoft/monaco-editor |
| lucide-react | ISC; https://github.com/lucide-icons/lucide |
| elkjs | EPL-2.0; https://github.com/kieler/elkjs |
| fontkit 2.0.4 / dfa 1.2.0 / brotli 1.3.3 | Upstream MIT declarations, with recorded full-text gaps; brotli decoder also includes Google Apache-2.0 code. See docs/distribution-notices/upstream-extra.json and retained Apache notice/text. |
| DOMPurify | Apache-2.0 OR MPL-2.0; https://github.com/cure53/DOMPurify |
| LLVM / Clang / libc++ | Apache-2.0 WITH LLVM-exception; https://github.com/llvm/llvm-project |
| mingw-w64 / Windows headers | Distribution COPYING.MinGW-w64.txt, component notices and COPYING.LGPLv2.1; https://github.com/mingw-w64/mingw-w64 |
| zlib / zstd (static analyzer dependencies) | zlib and BSD-3-Clause; full matching texts in native/analyzer/notices |
| Bundled fonts | SIL Open Font License 1.1; full matching texts in notices |

The optional WebDriver plugin is used only in the test build. Its HTTP server, global test API and automatic fixture path selector are absent from the distributed application. Full release SBOM and clean-machine offline installer validation remain release tasks.

## Materials kept under upstream licenses

- `src/diagram/fonts` and `spikes/layout-export/fonts`: unmodified Liberation Sans font files, SIL OFL-1.1; their `LICENSE_LIBERATION.txt` texts are retained.
- `docs/distribution-notices`: copied npm/Rust upstream notices, declarations and license texts; the inventory is a superset including build/non-Windows packages.
- `native/analyzer/notices`: LLVM/Clang (Apache-2.0 with LLVM exception), zlib and zstd (BSD-3-Clause distribution branch) license texts.
- `spikes/tauri/runtime-review/notices-source`: LGPL-2.1 text required by parts of the unmodified MinGW header distribution; it does not relicense the original FlowSketch source.
- IBM Plex Sans and JetBrains Mono: unmodified OFL fonts downloaded as locked npm packages; retain their license files in any binary package.

## Source references and unfinished binary-release audit

No third-party SDK or compiled application is distributed as a release asset in this initial source publication. Dependencies are resolved from pinned npm/Cargo lockfiles and verified official toolchain downloads when building locally.

For ELK, the selected distribution branch is EPL-2.0. `elkjs@0.12.0` identifies upstream commit `ff5771d7165445c42c408bb8a090c8035272218c`: https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c . This is a source reference, not confirmation of the complete preferred-source closure of the compiled worker: its build also consumes external ELK sources. Confirm that closure and provide the required source-availability statement before a public binary release.

The exact fontkit/brotli/dfa upstream references and the missing full MIT-text findings are preserved in `docs/distribution-notices/upstream-extra.json`. A generic MIT template must not be presented as a recovered upstream copyright/grant. The brotli decoder copyright notice and complete Apache-2.0 text are retained separately.

These known release tasks are tracked in ROADMAP.md (OSS-02, PACKAGE-01 and RELEASE-01). See docs/PUBLICATION.md for the boundary between the public source snapshot and historical local binary evidence.
