<!-- Last compiled at 2026-11-21_1906 -->
<!-- Copyright (c) 2026 SMYTHS TRADING CO LLC. All rights reserved. -->
<!-- https://toolsmyths.com -->
<!-- SPDX-License-Identifier: LicenseRef-Proprietary -->

# Notes for working in this repo

- **Version number**: `manifest.json` "version" (MAJOR.MINOR, shown in the settings header as "VineSmyths X.Y") must go up for
  every new build. Run `npm run bump` before committing a change that will be pushed (it also adds the CHANGELOG heading;
  describe the change under it). `npm run check` fails when manifest.json and the newest CHANGELOG heading disagree.
  Tell the user the version number when a build is ready ("version 1.6").
- `npm test` runs the checks, the unit tests and the browser tests; run it before pushing.
- Every source file carries the copyright header: `npm run stamp`.
