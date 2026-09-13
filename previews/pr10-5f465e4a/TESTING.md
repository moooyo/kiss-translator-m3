# Testing coverage

## This artifact run

Chrome, Firefox, and the dedicated preview web/userscript build were rebuilt serially with CI=true on the remote ssh test-env Linux host. No local tests, builds, or runtime probes were run. All 474 tracked source files are checked against the exact commit Git blob IDs before and after compilation, as well as against the Git archive contents.

Remote package checks cover ZIP structure and CRC integrity, root-level manifests, entry files, manifest equality with source, versions, preview userscript metadata, settings/update/download/site/logo/version URLs, and byte identity of every archived file with its build output. The standalone script must be byte-identical to the website package script. SHA256SUMS records the final downloadable asset bytes.

Packaged browser checks passed as described below. Public deployment checks are recorded separately in the artifact-QA.json release attachment.

## Previous verification

Before this artifact run, the PR changes passed 63 related Jest suites (754 tests) and changed-file formatting checks on the remote test-env host. After the final source correction, all 11 Popup Jest suites (128 tests) were rerun successfully. These tests were not rerun for packaging.

The committed source was previously built successfully for Chrome, Firefox, and standard web/userscript. Seven real Chromium 153.0.8010.12 cases passed on the committed production Chrome build: support menu width and keyboard navigation with and without scrollbars; retained-popup navigation and real reopen; ignoring a late response after navigation; iframe-only translation and capabilities; native PDF selection and capabilities; and Options local rendering, blocked editing, and state refresh during delayed sync.

The native Chrome toolbar closes entirely on Escape in this environment, including on unchanged baseline 7c68906f. Escape dismissal passed, but Escape trigger-focus restoration is not claimed. Pointer dismissal restored trigger focus. Options synchronization used a local protocol fixture, not a user account.

## Suggested checks

- Open the toolbar popup, expand Advanced options, and open the support menu in both short and scrolling layouts. Confirm stable popup width and keyboard navigation.
- Navigate from an ordinary page to a restricted browser page while the popup remains open. Confirm stale controls disappear and text translation remains available.
- Exercise translation on iframe-only pages and selection translation on native PDFs. Confirm controls match the available capabilities.
- Open Options with delayed synchronization. Confirm local content remains visible, editing is temporarily blocked, and synchronized values appear when synchronization finishes.
- Exercise failed page operations. Confirm that settings or toggles return to their confirmed state with an error indication.
- Install the dedicated userscript preview and use its matching commit-specific settings page.

Runtime checks cover the stated remote Chromium environment and fixtures. They do not establish full compatibility with every browser, provider, or userscript manager. Firefox is supplied as an unsigned temporary test package.

## Additional artifact browser checks

The extracted Chrome ZIP passed two checks in remote Linux Chromium 153.0.8010.12: the real toolbar default layout was 396 by 467 pixels without scrolling, and the support menu preserved the 396-pixel width in both default and expanded scrolling layouts. Keyboard opening, arrow navigation, and pointer dismissal passed. The extracted popup, content, and background JavaScript hashes remained unchanged.

Before publication, all 69 website files were served through an HTTP fixture on the remote test host and matched the build byte for byte. The matching settings page ran at the configured preview URL using those HTTP-served assets and an in-memory GM bridge mock. It rendered 14 settings controls with the expected preview APP_INFO, commit-specific settings URLs, and isolated preview storage keys, without uncaught page errors.

This is a simulated GM bridge check, not a real Tampermonkey installation. Public deployment checks are recorded in the separate artifact-QA.json attachment after publication. A pending public check is not a pass.
