# PR 10 test build

Source: https://github.com/moooyo/kiss-translator-m3/commit/5f465e4a0d03f32c802113a181b7d331c85abe85
Pull request: https://github.com/moooyo/kiss-translator-m3/pull/10
Source version: 2.0.32

## Chrome and Edge

Download `kiss-translator-pr10-5f465e4a-chrome.zip` and extract it. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, select **Load unpacked**, and choose the extracted directory containing `manifest.json`. The same ZIP supports Chrome and Edge.

To replace an earlier unpacked preview, extract this ZIP into a new directory and load that directory. Disable the old preview first.

## Firefox

Download `kiss-translator-pr10-5f465e4a-firefox.zip` and extract it. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the extracted `manifest.json`. This package is unsigned; the temporary installation ends when Firefox closes.

## Userscript

Install: https://moooyo.github.io/kiss-translator-m3/previews/pr10-5f465e4a/kiss-translator.user.js
Matching settings: https://moooyo.github.io/kiss-translator-m3/previews/pr10-5f465e4a/options.html

Use a desktop userscript manager such as Tampermonkey or Violentmonkey. The script has a separate preview name and namespace. Its settings, update, and download URLs are pinned to this commit-specific preview. The source version is unchanged, so explicitly open this installation link when replacing an earlier preview.

`kiss-translator-pr10-5f465e4a.user.js` is the same script as the installation URL. `kiss-translator-pr10-5f465e4a-userscript-web.zip` contains the complete matching website and userscript. Use the hosted settings page above for the normal testing flow. No iOS-specific package is provided.

## Testing

Keep only one KISS Translator extension or userscript active on a test page. The userscript uses a separate preview name and namespace, and unpacked extensions use their own extension storage. Existing settings may need to be imported. Import a settings backup through the preview settings page if needed.

See `TESTING.md` for verification coverage, `BUILD-PROVENANCE.json` for source and build details, and `SHA256SUMS` for asset integrity. These are preview artifacts for PR 10, not a new stable release.
