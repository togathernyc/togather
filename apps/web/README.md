# Togather Landing Page

Marketing website for Togather, built with React + Vite + Tailwind CSS and deployed to Cloudflare Pages.

## Live URLs

- **Production**: https://togather.nyc
- **Preview**: Auto-generated for each PR branch

## Development

```bash
# From repo root
pnpm install

# Start dev server (port 5173)
cd apps/web
pnpm dev
```

Visit http://localhost:5173

## Project Structure

```
apps/web/
├── src/
│   ├── App.tsx          # Main page component (all sections)
│   ├── main.tsx         # React entry point
│   └── index.css        # Tailwind imports + custom styles
├── public/
│   └── images/          # Static assets (screenshots, badges, logos)
├── index.html           # HTML entry point
└── vite.config.ts       # Vite + Tailwind config
```

## Tech Stack

- **React 19** + TypeScript
- **Vite 7** for dev/build
- **Tailwind CSS 4** for styling
- **Cloudflare Pages** for hosting

## Build & Deploy

```bash
# Build for production
pnpm build

# Preview production build locally
pnpm preview
```

Pushes to `main` auto-deploy to production via Cloudflare Pages (project: `togather-landing`).

## Static Pages

Some pages are still plain HTML (not part of the React app):

| Page | Path | File |
|------|------|------|
| Changelog | `/changelog` | `changelog.html` |
| Privacy Policy | `/privacy` | `privacy.html` |
| Terms of Service | `/terms` | `terms.html` |
| Android Download | `/android` | `android/index.html` |
