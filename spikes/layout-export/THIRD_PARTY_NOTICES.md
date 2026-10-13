# Dependencies and font notice

The font `fonts/LiberationSans-Regular.ttf` was copied without modification
from the Codex bundled pdfjs-dist standard_fonts resources. Its accompanying
SIL Open Font License 1.1 is preserved in `fonts/LICENSE_LIBERATION.txt`.
Digitized data copyright (c) 2010 Google Corporation; copyright (c) 2012
Red Hat, Inc. Reserved names and the complete conditions are in that file.
The exact font hash is in evidence/report.json and every scene.

Direct npm dependencies (exact versions in root package.json/package-lock):

| Component | Version | SPDX / upstream |
|---|---|---|
| elkjs | 0.12.0 | EPL-2.0; https://github.com/kieler/elkjs/blob/master/LICENSE.md |
| fontkit | 2.0.4 | MIT; https://github.com/foliojs/fontkit |
| pdfkit | 0.20.2 | MIT; https://github.com/foliojs/pdfkit |
| @resvg/resvg-js | 2.6.2 | MPL-2.0; https://github.com/thx/resvg-js |

Installed npm packages retain their own notices in node_modules. resvg loads
a platform-specific precompiled native addon from npm; no Rust compiler was
installed. This notice is a spike inventory, not a completed release SBOM or
an audit of every native transitive component. Production packaging must
retain the full matching distribution license texts and notices.
