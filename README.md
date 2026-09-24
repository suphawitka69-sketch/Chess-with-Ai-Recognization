# Chess Coach

A chess coaching app with self-play / ghost mode, engine analysis, and habit profiling.

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository.
2. In GitHub, open the repository.
3. Go to Settings > Pages.
4. Set Source to "GitHub Actions".
5. Commit and push to the `main` branch.
6. The workflow in `.github/workflows/deploy.yml` will build and deploy the site automatically.

The app is configured with `base: './'` so it works correctly under a GitHub Pages subpath.

## Notes

- The engine files live in `public/engine` and are referenced via relative URLs.
- This is a static deployment; browser COOP/COEP headers are required for multi-thread engine support.
