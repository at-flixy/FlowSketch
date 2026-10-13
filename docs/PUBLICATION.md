# Public source snapshot and evidence provenance

Initial publication: 13 October 2026. This repository starts from the completed developer-machine stages 1 and 2, then adds public documentation, SDK-free regression fixtures and portable verification defaults.

## Verification of the public checkout

The first public source commit, `b42050ae9390e8706eb6a1310e7e97ad8a70431a`, passed [GitHub Actions run 38421260627](https://github.com/at-flixy/FlowSketch/actions/runs/38421260627): Ubuntu scene/layout/oracle checks, TypeScript and frontend build; Windows dependency setup, pinned Rust bootstrap, 12 host tests and `cargo check`. This checks the public checkout independently of the original workstation. Documentation-only follow-up changes do not alter the tested implementation.

Before publication, the separate local source snapshot also passed `npm ci`, type checking, 12 scene tests, 10 layout tests, 5 oracle tests and the production web build. All 21 versioned graph fixtures match the original graph bytes. A fresh GitHub clone matched the published source commit; 53 local documentation links resolved. JSON evidence parsed successfully, and the specification PDF was checked for workstation/private-tracker strings. A scan for known token/private-key patterns and private workstation/tracker strings found no matches in the prepared public files. These checks do not constitute an exhaustive security audit.

The original local development history contained private workspace links and absolute workstation paths. The public repository begins with a new source snapshot. Public JSON/text evidence normalizes those paths to repository-relative or explicitly redacted locations; measurements, outcomes and original binary hashes remain historical observations. A hash in a historical report describes the original measured artifact, not every subsequent rebuild or a public release asset.

All application source, experiment source, lightweight evidence, the complete specification, approved design concepts and available third-party notices are included. Downloaded toolchains, node_modules, compiler build outputs, browser profiles and the old local portable ZIP are excluded. They are generated artifacts rather than source; the build guide explains how to reproduce them.

Stage 2 verification used Windows 11 x64 and the versions recorded in the reports. It does not establish behavior on a clean Windows VM, full specification coverage, every C++ input or universal timing guarantees. CI validates a separate public checkout. Interactive Windows E2E is not part of default GitHub CI.

## Source and binary licensing boundaries

The root MIT license covers original FlowSketch code, tests, documentation and project artwork. Upstream libraries, fonts, copied notices and headers retain their respective licenses.

The local prototype has not been published as a ready-to-download binary release. Before a public binary release, complete the release SBOM and source-availability obligations, including ELK's EPL-2.0 distribution terms; resolve the preserved full MIT-text gaps for fontkit/brotli/dfa; verify the exact bundled headers and required notices; then test the actual package on clean Windows. These are tracked in PACKAGE-01 and RELEASE-01. Dependency metadata and retained declarations are evidence for the audit, not a claim that the audit is finished.
