# SeatSpecs GitHub Pages site

Plain HTML/CSS, English only for now. No site generator, JavaScript, external fonts, analytics, tracking, forms, advertising or third-party embeds. The website is independent of the extension build and adds no extension permissions.

- `index.html`: product landing page, screenshots, Chrome Web Store install links and optional source installation instructions.
- `privacy.html`: extension privacy policy and a separate disclosure for GitHub Pages hosting.
- `styles.css`: responsive, shared styles.
- `assets/`: checked-in copies of the original icon and store screenshots.
- `.nojekyll`: tells GitHub Pages to serve the static files without Jekyll processing.

All internal links and asset URLs are relative, so both a project path such as `/seatspecs/` and a domain root work. There is no hard-coded repository owner or Pages domain. The install buttons use the provided [SeatSpecs Chrome Web Store listing](https://chromewebstore.google.com/detail/seatspecs-%E2%80%94-seat-types-le/ejaocnhjedaengiacnhlppbhgimfehog).

## Refresh the assets

After updating the icon or store screenshots:

```sh
npm run pages:sync
```

This copies only the four public artwork files used by the site. It does not publish raw captures, session data, the source tree, or the extension ZIP. Tests compare these copies with their originals to prevent drift.

## Preview locally

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000/`. Browser tests additionally serve the files under a non-root project path and check mobile/desktop layouts, assets, internal links, keyboard navigation and operation with JavaScript disabled.

## Publish from this repository

1. Push the repository, including `docs/`, to GitHub. No remote was configured when the site was added; no repository URL is assumed.
2. In **Settings → Pages → Build and deployment**, choose **Deploy from a branch**.
3. Select **main** and **/docs**, then save.
4. Wait for the Pages deployment and use the actual URL shown in Settings.

The usual project URLs are:

- Homepage: `https://<owner>.github.io/<repository>/`
- Privacy policy: `https://<owner>.github.io/<repository>/privacy.html`

Use the published privacy URL in the Chrome Web Store dashboard. The site is **not** deployed by creating these files, and no GitHub account settings are changed by the tooling.

## Before publishing

- Review the privacy policy against the extension's current behavior. It describes local processing explicitly rather than claiming no data is ever read.
- Configure the developer contact/support details on the real Chrome Web Store listing; the policy directs privacy questions there. You can replace this with your chosen public contact or issue-tracker URL. Do not publish a private Git author email accidentally.
- The Web Store link is configured. Add the actual repository/source/support links once the GitHub repository URL is known. No repository URL, private email address or custom domain is guessed.
- GitHub Pages is public, even when supported for a private source repository. Publish only files intended to be public.
- GitHub logs visitors' IP addresses for security. The policy distinguishes this hosting behavior from the extension's local-only processing.

No npm install, Actions workflow, environment secrets or extension build is needed on GitHub to serve this site.

See [GitHub's publishing-source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
