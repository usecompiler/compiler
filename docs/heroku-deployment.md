# Heroku Container Deployment

Deploy Compiler to Heroku using container-based deployment. This guide covers deploying to dynos with ephemeral storage where repositories are fetched on-demand.

## Prerequisites

- Heroku account with container registry access
- Heroku CLI installed

## Overview

Heroku dynos have ephemeral filesystems - any files written to disk are lost when the dyno restarts. This deployment configures Compiler to:

1. Store repository metadata in Heroku Postgres (persistent)
2. Clone repositories on-demand to `/tmp/repos` (ephemeral)
3. Automatically re-clone missing repositories when needed

## Setup

### 1. Create a Wrapper Repository

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

### 2. Create Heroku App

```bash
heroku create your-app-name
heroku stack:set container -a your-app-name
```

### 3. Add Heroku Postgres

```bash
heroku addons:create heroku-postgresql:essential-0 -a your-app-name
```

This automatically sets the `DATABASE_URL` environment variable. Heroku Postgres requires SSL, so enable it:

```bash
heroku config:set DATABASE_SSL=true -a your-app-name
```

### 4. Configure Environment Variables

```bash
heroku config:set TOKEN_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") -a your-app-name
heroku config:set REPOS_DIR=/tmp/repos -a your-app-name
```

### 5. Deploy

```bash
git push heroku main
```

## Environment Variables

| Variable               | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`         | Set automatically by Heroku Postgres add-on                    |
| `DATABASE_SSL`         | Set to `true` for Heroku Postgres (appends `?sslmode=require`) |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex string for encrypting tokens                       |
| `REPOS_DIR`            | Set to `/tmp/repos` for ephemeral storage                      |

AI provider (Anthropic API or AWS Bedrock) and GitHub App credentials are configured through the onboarding flow, not as environment variables.

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
