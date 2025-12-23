# Docker Deployment

Deploy Gist using Docker with automatic SSL via Caddy.

## Prerequisites

- Server with Docker and Docker Compose installed
- Domain name pointing to your server
- GitHub App (see below)
- Anthropic API key

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/the-gist-app/gist.git
   cd gist
   ```

2. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your values (see Configuration below)

4. Start the services:
   ```bash
   docker compose up -d
   ```

5. Access your instance at `https://your-domain.com`

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DOMAIN` | Your domain (e.g., `gist.example.com`) |
| `ANTHROPIC_API_KEY` | API key from [console.anthropic.com](https://console.anthropic.com/) |
| `POSTGRES_PASSWORD` | Database password (choose a secure one) |
| `GITHUB_APP_ID` | Your GitHub App ID |
| `GITHUB_APP_SLUG` | Your GitHub App slug |
| `GITHUB_PRIVATE_KEY` | GitHub App private key (PEM format) |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex string for encrypting tokens |

### Generating TOKEN_ENCRYPTION_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Creating a GitHub App

1. Go to [GitHub Developer Settings](https://github.com/settings/apps/new)

2. Fill in the required fields:
   - **App name**: Choose a name (e.g., "My Gist App")
   - **Homepage URL**: Your domain
   - **Callback URL**: `https://your-domain.com/onboarding/github-callback`

3. Set permissions:
   - **Repository permissions**:
     - Contents: Read-only
     - Metadata: Read-only

4. After creating, note down:
   - App ID
   - Generate and download a private key

5. Add these to your `.env` file

## Internal/Firewall Deployment

If deploying behind a firewall without public SSL, you can skip Caddy.

Create a `docker-compose.override.yml`:

```yaml
services:
  app:
    ports:
      - "3000:3000"
  caddy:
    profiles:
      - disabled
```

Then access directly at `http://your-server:3000`.

## Updating

Pull the latest image and restart:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on startup.

## Data & Backups

Data is stored in Docker volumes:
- `pgdata` - PostgreSQL database
- `repos` - Cloned repositories
- `caddy_data` - SSL certificates

To backup the database:
```bash
docker compose exec db pg_dump -U gist gist > backup.sql
```
