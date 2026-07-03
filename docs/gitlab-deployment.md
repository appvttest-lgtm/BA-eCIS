# Deploying Barcode Auditer from GitLab CI

The repo ships a pipeline (`.gitlab-ci.yml`) that builds everything on a standard
Linux Docker runner — no Windows build machine and no local `.bat` scripts needed.
Every pipeline run produces two ready-to-distribute zips as downloadable artifacts.

## What the pipeline produces

| Job | Artifact | Use when |
| --- | --- | --- |
| `build-portable` | `BarcodeAuditer-v<version>-windows-x64-portable.zip` (+ `.sha256`) | You can get the launcher `.exe` signed / allowlisted. Contains the web app, a native Win32 launcher exe (cross-compiled with MinGW from `wrapper/windows/BarcodeAuditerLauncher.cpp`), and a bundled `node\node.exe` runtime. Double-click experience, no Node install needed. |
| `build-source-share` | `BarcodeAuditer-v<version>-run-with-nodejs.zip` (+ `.sha256`) | Workstation policy blocks unsigned/unknown exes. Contains `dist/` + `server.mjs` + README; the recipient installs Node.js from the company software portal and runs `node server.mjs`. Nothing to sign, nothing for endpoint security to flag. |

The `<version>` is read from `package.json` at build time, so artifacts can never
drift from the app version.

## Running the pipeline

Pipelines run automatically on every push. To run one manually:

1. In GitLab: **Build → Pipelines → Run pipeline**, pick the branch, **Run**.
2. Wait for the `build` stage jobs to go green.

## Downloading the artifacts

1. **Build → Pipelines** → click the pipeline → click the job (`build-portable` or
   `build-source-share`).
2. Use **Download** (whole artifact zip) or **Browse** (pick individual files) in
   the right-hand panel.
3. Verify integrity on the receiving machine against the `.sha256` file:

   ```powershell
   Get-FileHash .\BarcodeAuditer-v1.13.2-windows-x64-portable.zip -Algorithm SHA256
   ```

Artifacts expire after 30 days — re-run the pipeline if the download link has aged
out. For permanent copies, attach the zip to a GitLab Release.

## First-run checklist on a corporate GitLab instance

Work through these once with your GitLab admin if the first pipeline does not run
or fails early:

1. **Runner availability / tags.** The jobs declare no `tags:`, so they need an
   untagged shared Linux Docker runner. If jobs sit at *pending*, add your
   instance's runner tag under each job:

   ```yaml
   build-portable:
     tags: [docker]
   ```

2. **Docker image access.** Jobs use `node:22-bookworm` from Docker Hub. If the
   instance only allows an internal mirror, prefix the image accordingly, e.g.
   `registry.corp.example/dockerhub/node:22-bookworm`.
3. **Outbound network.** `build-portable` needs `apt-get` (Debian repos or internal
   mirror), the npm registry, and `nodejs.org` (Windows Node runtime download). Set
   the standard `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` CI/CD variables if the
   runners sit behind a proxy, and `NPM_CONFIG_REGISTRY` if npm must use an
   internal registry. For fully air-gapped CI, `.gitlab-ci.yml` documents the
   workaround: commit `node.exe` (or pull it from an internal mirror) instead of
   downloading it.
4. **CI/CD enabled.** Project **Settings → General → Visibility, project features,
   permissions → CI/CD** must be on (it is by default).

## Signing the launcher exe (portable variant only)

CI produces an **unsigned** `BarcodeAuditer.exe`. Unsigned exes trip SmartScreen
and antivirus heuristics and may be blocked outright by AppLocker/WDAC, so plan
for signing as a post-build step owned by whoever holds the code-signing
certificate:

1. Download the portable artifact and unzip it.
2. On the machine with the corporate signing certificate (Windows SDK provides
   `signtool`):

   ```powershell
   signtool sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /a .\BarcodeAuditer.exe
   signtool verify /pa /v .\BarcodeAuditer.exe
   ```

   Use `/f cert.pfx /p <password>` instead of `/a` if the cert is a file rather
   than in the certificate store. The timestamp (`/tr`) keeps the signature valid
   after the certificate expires.
3. Re-zip and distribute the signed package.

Notes:

- Sign **after** any other modification to the exe — any change invalidates the
  signature.
- An internal-CA certificate is only trusted inside the organisation, which is
  fine for an internal tool.
- Even signed, a brand-new binary may need an AppLocker/WDAC allowlist entry
  (binary hash or the signing cert). Raise that with IT alongside the signing
  request — signing alone does not bypass application control.
- If signing is slow to arrange, ship the `run-with-nodejs` artifact in the
  meantime; it is the same app with no exe involved.

## Installing on the target machine

**Portable (exe) variant:** unzip anywhere writable (e.g. Documents), double-click
`BarcodeAuditer.exe`. The launcher starts the bundled Node runtime and opens the
tool. Everything runs locally on `127.0.0.1`; no label data leaves the machine.

**Run-with-Node variant:** follow the `README.md` inside the zip — install
Node.js LTS from the company software portal, then from the unzipped folder run:

```powershell
node server.mjs
```

and open `http://127.0.0.1:3000`.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Pipeline never starts | CI/CD disabled for the project, or no runner matches (see checklist items 1 and 4). |
| Job fails in `before_script` on `apt-get` | No route to Debian mirrors — proxy variables or internal apt mirror needed. |
| `npm ci` fails with network/403 errors | Point npm at the internal registry (`NPM_CONFIG_REGISTRY`) or set proxy variables. |
| `curl` of the Node Windows runtime fails | Runner cannot reach nodejs.org — use the air-gap workaround documented in `.gitlab-ci.yml`. |
| Built exe blocked or flagged on workstations | Expected for unsigned binaries — sign and allowlist it (see above), or use the run-with-nodejs artifact. |
| Artifact download link gone | Artifacts expired (30 days) — re-run the pipeline or attach zips to a Release. |
