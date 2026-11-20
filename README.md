# QUB-PHEO website

Source for the [QUB-PHEO research website](https://qub-pheo.pages.dev/), with a
five-camera browser visualiser and research/data-access documentation.

The website opens on the visualiser. The navigation ribbon stays visible while
scrolling. Body overlays use COCO-17 and MediaPipe-33 skeletons, preserving saved
validity and confidence semantics. The research sections explain motivation,
study protocol, assembly tasks, preprocessing, evaluation and limitations.

## Repository contents

- `public/`: buildless HTML, CSS, JavaScript and Cloudflare routing/header files.
- `server/` and `migrations/`: approval/delivery backend and private audit schema.
- `tests/`: viewer, security, SQL state-machine and external-API boundary tests.
- `public/eula/`: the unsigned official agreement, never applicant documents.
- `scripts/export_web_samples.py`: offline browser export using the pinned
  QUB-HRI readers and ffmpeg.
- `scripts/package_public_portal.py`: verified, explicit deployment allowlist.

**No videos, landmark data, dataset manifests, model weights or deployment ZIPs
are committed.** The public website serves 20 approved examples separately from
Git. Full dataset delivery stays on Drive, subject to the official EULA and
approval from Seán McLoone or Samuel Adebayo. This code repository does not change dataset permissions.
Signed-PDF intake, private admin review, audit export and the approved Drive
delivery path are live. Sam’s admin login and the restricted Google connection
are verified; the first genuine approved delivery remains a pilot check. See [access operations](docs/access-operations.md).

## Local development

The visualiser is plain HTML/JS. Node 24 is used for backend tests and bundling.
For a source-only frontend preview, use Python 3:

```bash
python -m http.server 8765 --bind 127.0.0.1 --directory public
```

Open http://127.0.0.1:8765/. To test local sample playback, select **Open local
sample folder** and choose a verified `web-v1` export outside this repository.
The source-only server will otherwise report missing public samples: media is
intentionally absent from Git. Files selected locally remain in the browser.

Run the tests with a current Node.js:

```bash
npm ci
npm test
```

## Prepare browser samples

This step needs ffmpeg/ffprobe, Python with numpy/h5py/OpenCV, the validated source
bundle and the QUB-HRI reference checkout. It runs no model inference.

```bash
python scripts/export_web_samples.py \
  --source /path/to/validated-source-bundle \
  --target /path/to/new-web-export \
  --viewer-root /path/to/pinned-QUB-HRI-checkout
```

Reader revision: `aa5a5f76ff5ebae65c273ebb34b4a7ceef7e8b11` in
[QUB-HRI](https://github.com/exponentialR/QUB-HRI). Existing exports are not
overwritten. All source hashes, preview frame counts and timestamps are checked;
H.264 previews omit audio and keep source-relative timing. Landmark chunks retain
original image coordinates. Source videos and HDF5 files remain untouched.

## Package and deploy

The current approved sample set has 20 groups, each with AV/UL/UR/LL/LR video and
matching landmarks. Packaging validates that exact scope and source checksums:

```bash
npm run build:worker
python scripts/package_public_portal.py --source /path/to/web-v1 --out dist
```

The resulting `dist/qub-pheo-public-samples.zip` contains the website plus only
100 approved preview videos, 790 landmark chunks and their public catalog.
The ZIP and audit manifest are ignored by Git. Never add the source archive,
HDF5 files or unselected participants to the deployment package.

Upload this ZIP to the existing **qub-pheo** Cloudflare Pages direct-upload
project. Do not upload only `public/`: doing so would remove the hosted examples.
Deployment is manual; this repository has no push-triggered CI or automatic
Cloudflare publishing. Pages serves sample files as static assets, without R2.
No new paid plan or domain is required for this deployment. The package remains
below the dashboard's 1,000-file / 25 MiB-per-file limits and the 8 GB sample budget.

The access API is configured with a private database, administrator sign-in,
bot protection and a Google identity scoped to the approved release folder. The legacy gated
media API remains closed. Public examples live under `/samples/v1/`; they do not unlock the
full dataset or bypass the EULA process.

## Research references

- [Dataset paper: IEEE Access (2024)](https://doi.org/10.1109/ACCESS.2024.3485162)
- [QUB-PHEO dataset documentation and benchmarks](https://github.com/exponentialR/QUB-PHEO)
- [QUB-HRI preprocessing and original local visualiser](https://github.com/exponentialR/QUB-HRI)

## EULA requests and admin dashboard

Applicants upload the existing signed PDF at `/request.html`; authorised admins
review it at `/admin.html`. Both nominated administrators can approve or deny,
inspect document hashes, reconcile approved delivery failures and export the full
audit snapshot. Pending or denied requests cannot create Drive permissions.
New grants are individual readers; existing permissions are preserved.

Production intake is enabled. See
[access operations](docs/access-operations.md) for verified state, remaining pilot
checks and safe pause/recovery. The public sample
explorer remains independent. For a safe fixture-only UI test, run:

```bash
npm run dev:access
```

One build-only dependency (esbuild) bundles the Worker; it adds no runtime cloud
service. Private small signed PDFs reside in D1, avoiding a new object-store or
mail vendor. No applicant records or credentials belong in this repository.

Historical signed agreements can be archived separately in the private dashboard.
Their original PDF/hash/filename, reported approver and data sharer, known form
date and actual import provenance are preserved. Unknown contacts or historical
event dates stay unknown; archival imports never call Google’s sharing API. Apply
`migrations/0002_historical_records.sql` to an existing v1 database before deploying
this version. Signed documents and historical applicant metadata stay outside Git.
