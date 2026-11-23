# Notes to X Articles

Paste a note with images into an X Article draft in desktop Chrome. The extension uses X’s built-in media controls to place each image. You review the draft and publish it yourself.

## Install

Build the extension with `npm run build:x-article-extension` from the Notes repository. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the generated `dist-x-article-extension` folder.

## Paste an article

1. Open the note on [Notes](https://notes.fangyuanxiaozhan.com/). In Share, choose **复制到 X 文章**.
2. Open or reload the [X Articles editor](https://x.com/compose/articles), click inside the body of a draft, and paste once.
3. Wait for the image progress to finish, then check the placement before publishing.

The extension recognizes the rich clipboard from **复制到 X 文章**. When every image is in the Notes library, the copy button confirms success without opening the image dialog. The extension also accepts **复制文字** Markdown containing a Notes library image on older versions of Notes. It downloads originals from that library, including repeated images, and keeps the corresponding draft marker when a file is unavailable or X rejects an insertion. Images hosted elsewhere can be imported into Notes first. Use **Stop** in the progress panel to stop processing further images.

Chrome gives the extension access to x.com so it can recognize Articles when you navigate there from another X page. Its paste handler runs only in the Articles composer. Media downloads are limited to the production Notes image library. No X API key or separate account is required.

## Verify locally

After building, run `node scripts/verify-x-article-extension.mjs` to check the Markdown fallback against a simulated X editor. Use `NOTES_EXTENSION_PRODUCER=local` after building Notes to test the actual rich clipboard from the web build, or `NOTES_EXTENSION_PRODUCER=production` to test the live Notes copy action. Both use an isolated Chromium profile and the simulated X editor.
