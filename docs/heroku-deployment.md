# Heroku Container Deployment

Deploy Compiler to Heroku using container-based deployment. This guide covers deploying to dynos with ephemeral storage where repositories are fetched on-demand.

## Prerequisites

- Heroku account with container registry access
- Heroku CLI installed
- GitHub App configured (see [Docker Deployment](./docker-deployment.md#creating-a-github-app))
- Anthropic API key

## Overview

Heroku dynos have ephemeral filesystems - any files written to disk are lost when the dyno restarts. This deployment configures Compiler to:

1. Store repository metadata in Heroku Postgres (persistent)
2. Clone repositories on-demand to `/tmp/repos` (ephemeral)
3. Automatically re-clone missing repositories when needed

## Setup

### 1. Create a GitHub App

Create a GitHub App for your Heroku deployment:

1. Go to **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set the following fields:
   - **GitHub App name**: Choose a unique name (e.g., `your-company-compiler`)
   - **Homepage URL**: `https://your-app-name.herokuapp.com`
   - **Callback URL**: `https://your-app-name.herokuapp.com/onboarding/github-callback`
3. Set **Repository permissions**:
   - **Contents**: Read-only
   - **Metadata**: Read-only
4. Click **Create GitHub App**
5. Note the **App ID** from the app settings page
6. Note the **App slug** from the URL (the part after `/apps/`)
7. Generate a **Private key** and download it

### 2. Create a Wrapper Repository

Create a new repository with the following `heroku.yml`:

```yaml
build:
  docker:
    web: Dockerfile
release:
  image: web
  command:
    - npx drizzle-kit migrate
run:
  web: npm run prefetch && npm run start
```

And a `Dockerfile` that pulls the Compiler image:

```dockerfile
FROM ghcr.io/usecompiler/compiler:main
```

### 3. Create Heroku App

```bash
heroku create your-app-name
heroku stack:set container -a your-app-name
```

### 4. Add Heroku Postgres

```bash
heroku addons:create heroku-postgresql:essential-0 -a your-app-name
```

This automatically sets the `DATABASE_URL` environment variable.

### 5. Configure Environment Variables

```bash
heroku config:set ANTHROPIC_API_KEY=sk-ant-... -a your-app-name
heroku config:set GITHUB_APP_ID=123456 -a your-app-name
heroku config:set GITHUB_APP_SLUG=your-app-slug -a your-app-name
heroku config:set GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----" -a your-app-name
heroku config:set TOKEN_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") -a your-app-name
heroku config:set REPOS_DIR=/tmp/repos -a your-app-name
heroku config:set DATABASE_SSL=true -a your-app-name
```

### 6. Deploy

```bash
git push heroku main
```

## Environment Variables

| Variable               | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`         | Set automatically by Heroku Postgres add-on                          |
| `ANTHROPIC_API_KEY`    | API key from [console.anthropic.com](https://console.anthropic.com/) |
| `GITHUB_APP_ID`        | Your GitHub App ID                                                   |
| `GITHUB_APP_SLUG`      | Your GitHub App slug                                                 |
| `GITHUB_PRIVATE_KEY`   | GitHub App private key (PEM format)                                  |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex string for encrypting tokens                             |
| `REPOS_DIR`            | Set to `/tmp/repos` for ephemeral storage                            |
| `DATABASE_SSL`         | Set to `true` for Heroku Postgres (requires SSL)                     |

## Behavior on Dyno Restart

When a Heroku dyno restarts:

1. All cloned repositories in `/tmp/repos` are lost
2. Repository metadata remains in Heroku Postgres
3. The prefetch script runs before the server starts, cloning all repositories
4. Once prefetch completes, the server starts and handles requests normally

The prefetch step ensures that repositories are ready before the first user request, avoiding timeout issues with large repositories.

## Performance Considerations

### Startup Time

The prefetch step clones all repositories before the server starts. Startup time depends on:

- Number of repositories across all organizations
- Size of repositories
- Network speed to GitHub

During prefetching, the dyno is not yet serving requests. Heroku will wait for the process to bind to the port before routing traffic.

### Dyno Sleeping

On eco dynos, the app sleeps after 30 minutes of inactivity. Waking up triggers a full restart including prefetching all repositories.

## Updating

Pull the latest image:

```bash
git pull  # if upstream Dockerfile changed
git push heroku main
```

Or rebuild with the latest base image:

```bash
heroku container:push web -a your-app-name
heroku container:release web -a your-app-name
```

## Troubleshooting

### Repositories not cloning

Check logs for clone errors:

```bash
heroku logs --tail -a your-app-name
```

Common issues:

- GitHub App permissions not set correctly
- Private key format issues (ensure newlines are preserved)
- TOKEN_ENCRYPTION_KEY not set

### Database connection errors

Verify Postgres is attached:

```bash
heroku addons -a your-app-name
heroku config:get DATABASE_URL -a your-app-name
```

### Slow startup

If startup takes too long, check:

```bash
heroku logs --tail -a your-app-name
```

Look for "Prefetching repositories..." messages. Large repositories or many organizations will increase startup time. Consider reducing the number of connected repositories if startup is too slow.
