# Blitz November Sales Contest board

A static scoreboard published with GitHub Pages. A GitHub Actions job pulls deal data
from HubSpot every 15 minutes (7 AM to midnight IST) and republishes the page.

- Page: `site/index.html`
- HubSpot pull: `scripts/fetch-hubspot.mjs` (reads the `HUBSPOT_TOKEN` repository secret)
- Schedule: `.github/workflows/refresh.yml`

Deal data is never committed to this repository; it only exists in the published page.
