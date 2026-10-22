# Contributing

Thanks for your interest! This repository is the live website of Delta AI Innovation, so changes are made by our team.

- **Found a bug on the site?** Open a [website bug report](https://github.com/A-nkitPandey/delta-ai-web/issues/new/choose).
- **Found a security issue?** Please follow [SECURITY.md](SECURITY.md) and report it privately.
- **Want to work with us?** See open roles at [deltaaiinnovation.in/careers](https://deltaaiinnovation.in/careers).
- **Business enquiry?** Use [the contact form](https://deltaaiinnovation.in/#contact) or WhatsApp.

## For our team

1. Branch from `main` and keep each pull request to one change.
2. Edit content in `src/content/` before touching components.
3. Before opening a pull request, run:
   ```bash
   npm run check
   npm run build
   ```
4. Check the changed pages on a phone-sized screen, in light and dark themes.
5. Never commit secrets, personal names or client data.

Merging to `main` deploys to production through Cloudflare Workers Builds.
