# QUB-PHEO website

Source for the [QUB-PHEO research website](https://qub-pheo.pages.dev/), with a
five-camera browser visualiser and research/data-access documentation.

The website opens on the visualiser. The navigation ribbon stays visible while
scrolling. Body overlays use COCO-17 and MediaPipe-33 skeletons, preserving saved
validity and confidence semantics. The research sections explain motivation,
study protocol, assembly tasks, preprocessing, evaluation and limitations.

## Repository contents

- `public/`: buildless HTML, CSS, JavaScript and Cloudflare routing/header files.
- `tests/`: timing, path, access-boundary and body-topology regression tests.
- `scripts/export_web_samples.py`: offline browser export using the pinned
  QUB-HRI readers and ffmpeg.
- `scripts/package_public_portal.py`: verified, explicit deployment allowlist.

**No videos, landmark data, dataset manifests, model weights or deployment ZIPs
are committed.** The public website serves 20 approved examples separately from
Git. Full dataset delivery stays on Drive, subject to the official EULA and
Seán McLoone’s approval. This code repository does not change dataset permissions.
Electronic-signature administration and automatic Drive delivery are not implemented.

## Local development

No frontend framework, installation or build step is needed. Use Python 3 to serve:

```bash
python -m http.server 8765 --bind 127.0.0.1 --directory public
```

Open http://127.0.0.1:8765/. To test local sample playback, select **Open local
sample folder** and choose a verified `web-v1` export outside this repository.
The source-only server will otherwise report missing public samples: media is
intentionally absent from Git. Files selected locally remain in the browser.

Run the tests with a current Node.js:

```bash
node --test tests/*.test.mjs
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

The `/api/*` handler remains closed until a real controlled-access backend is
configured. Public examples live under `/samples/v1/`; they do not unlock the
full dataset or bypass the EULA process.

## Research references

- [Dataset paper: IEEE Access (2024)](https://doi.org/10.1109/ACCESS.2024.3485162)
- [QUB-PHEO dataset documentation and benchmarks](https://github.com/exponentialR/QUB-PHEO)
- [QUB-HRI preprocessing and original local visualiser](https://github.com/exponentialR/QUB-HRI)
