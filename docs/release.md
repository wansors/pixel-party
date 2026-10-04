# Releases: versions and the Docker image

How a change on `develop` becomes a numbered release and a Docker image on Docker Hub, and what has to
be configured once for that to work. The image itself (ports, environment variables, how to run it)
is documented in [`docker.md`](docker.md), which CI also publishes as the Docker Hub description.

## The flow (trunk-based on `develop`)

Every push to `develop` runs CI (`.github/workflows/ci.yml`):

1. **Gate**:
   - **server + shared**: determinism check, Biome, typecheck, `bun test`;
   - **client**: Vitest specs and the production build.
2. **Release**, only if both gate jobs pass and Docker Hub is configured:
   1. **Version**: `scripts/release-version.ts` picks the next version and writes it into every
      `package.json` and into `APP_VERSION` (what the options panel, `/api/health` and the startup
      log show).
      - Every release bumps at least the **minor**: `1.3.0` → `1.4.0`.
      - A commit since the last release whose subject is marked `!` (`feat!: …`), or that has a
        `BREAKING CHANGE:` footer, bumps the **major**: `1.4.0` → `2.0.0`.
      - The very first release publishes the current version (`1.0.0`, the public beta) unchanged.
   2. **Commit and tag**: `chore(release): vX.Y.Z [skip ci]` is pushed to `develop` and tagged
      `vX.Y.Z`. A GitHub Release with generated notes is created for the tag.
   3. **Image**: built from the `Dockerfile` for `linux/amd64` and `linux/arm64` and pushed as
      `X.Y.Z`, `X.Y`, `X` and `latest`.
   4. **Docker Hub page**: its description is replaced with `docs/docker.md`.

Pull requests run the gate plus an image build that isn't pushed, so a broken `Dockerfile` shows up
before it reaches `develop`.

If several pushes land while CI runs, only the newest one is released (it contains the earlier ones);
the older runs skip their release step.

### A manual release

*Actions → CI → Run workflow* on `develop`. Choose the bump:
- `auto` (as above);
- `minor`, `major` or `patch` (a patch is only ever chosen by hand).

### After a release, pull before you push

The release commit lands on `develop` on GitHub, so your local `develop` is one commit behind. Run
`git pull --rebase` before your next push (or set `git config pull.rebase true` once).

## One-time setup

### 1. Docker Hub

1. The repository is <https://hub.docker.com/r/wansors/pixel-party> (public).
2. *Account settings → Personal access tokens → Generate new token*, with **Read, Write, Delete**
   permissions. Docker Hub requires Delete for the step that updates the repository description.
   Make a new token for this repository rather than reusing another project's: GitHub secrets can't
   be read back or shared between repositories of a personal account. A token per project can also
   be revoked on its own.

### 2. GitHub repository settings

*Settings → Secrets and variables → Actions*:

| Kind | Name | Value |
|---|---|---|
| **Secret** | `DOCKERHUB_TOKEN` | the token from step 1, the only thing you **must** add |
| Variable *(optional)* | `DOCKERHUB_USERNAME` | the Docker Hub user to log in as, if it isn't `wansors` |
| Variable *(optional)* | `DOCKERHUB_IMAGE` | the full image name, if it isn't `<user>/pixel-party` |

**While `DOCKERHUB_TOKEN` is missing, the release does nothing**: the step leaves a notice and CI stays
green. No versions are bumped until then either.

*Settings → Actions → General → Workflow permissions*: **Read and write permissions**, so the release
can push its commit and tag. If `develop` is a protected branch, allow GitHub Actions to push to it,
or the release commit is rejected.

## Locally

```bash
bun scripts/release-version.ts          # what CI would do: prints the version, edits the files
bun scripts/release-version.ts patch    # force a bump kind
# undo a local dry run (only the files the script touches):
git checkout -- package.json apps/client/package.json apps/server/package.json \
  packages/shared/package.json packages/shared/src/version.ts
```

The image builds anywhere Docker runs, with no other tools needed:

```bash
docker build -t pixel-party:dev --build-arg VERSION=dev .
docker run --rm -p 3000:3000 pixel-party:dev
```
