# CraneBrain

Offline-first phone web app for crane field work. It has three modes off one home screen:

- **Service report:** a 36-item checklist with six grades (As new → Unsafe), photos per item taken from the camera, ID-plate and paperwork photos, actions and parts, and a customer signature. Exports to PDF.
- **Site evaluation:** add a customer once, check each crane on site, and produce one combined export with a single sign-off.
- **Remedial works report:** the site is captured once; the work done and photos are recorded per crane and compiled into one PDF.

## Layout

| Path | What it is |
|---|---|
| `public/` | **Live version** (deployed to Cloudflare 8 Oct 2026). `index.html` is the whole app (vanilla JS, jsPDF). `runtime.js` connects the app's storage calls to the `/api` backend. `sw.js` is the offline service worker. |
| `preview/index.html` | **Newest, unreleased version** (8 Oct 2026, evening). Adds issued/locked report revisions (Rev A, B…), SHA-256 record IDs, per-crane history, a dedicated Unsafe-findings section and selective downloads. It was built as a Claude artifact preview, so it keeps data in the browser. To ship it, it needs `<script src="/runtime.js?v=2"></script>` added and the preview banner removed. |
| `src/worker.js` | Cloudflare Worker: verifies the Cloudflare Access JWT, runs the JSON doc API on D1 (`/api/list`, `/api/doc`, `/api/export`), handles photo upload/serve on R2 (`/api/photo`, `/_blob/:id`), and serves the static app. |
| `scripts/build.mjs` | Inlines `public/` into `src/files.generated.js` (this is how the live Worker is bundled). |
| `schema.sql` | D1 table, inferred from the Worker's queries. |

## Run / deploy

```
npm i
npx wrangler d1 execute cranebrain --file=schema.sql   # first time only
npm run dev       # local (set DEV_MODE=yes and DEV_EMAIL in .dev.vars to bypass Access)
npm run deploy
```

Access is fail-closed: with no valid `Cf-Access-Jwt-Assertion` header, every API and photo request returns 401. Data is scoped per signed-in email.

## Notes for reviewers

- The source was recovered from the deployed Worker bundle. Running `npm run build` reproduces the live asset bundle byte for byte.
- The Access team domain and AUD tag currently have hard-coded fallbacks in `src/worker.js`. These should move to env vars only.
- There is some legacy naming (`levate-*` IndexedDB names and import keys), kept so older exports and local data still load.
