# Docker Deployment

Deploy Compiler using Docker with automatic SSL via Caddy.

## Prerequisites

- Server with Docker and Docker Compose installed
- Domain name pointing to your server

## Quick Start

1. Clone the repository:

   ```bash
   git clone https://github.com/usecompiler/compiler.git
   cd compiler
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

| Variable               | Description                                |
| ---------------------- | ------------------------------------------ |
| `DOMAIN`               | Your domain (e.g., `compiler.example.com`) |
| `POSTGRES_PASSWORD`    | Database password (choose a secure one)    |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex string for encrypting tokens   |

### Generating TOKEN_ENCRYPTION_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Creating a GitHub App

1. Go to [GitHub Developer Settings](https://github.com/settings/apps/new)

2. Fill in the required fields:
   - **App name**: Choose a name (e.g., "My Compiler App")
   - **Homepage URL**: Your domain
   - **Callback URL**: `https://your-domain.com/onboarding/github-callback`

3. Set permissions:
   - **Repository permissions**:
     - Contents: Read-only
     - Metadata: Read-only

4. After creating, note down:
   - App ID (numeric ID from settings page)
   - App slug (from the URL: github.com/apps/**your-app-slug**)
   - Generate and download a private key

5. You'll enter these credentials during the onboarding flow after initial setup

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
docker compose exec db pg_dump -U compiler compiler > backup.sql
```
