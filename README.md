# Gist

An AI-powered project assistant that helps teams have conversations about their code using Claude.

## Features

- **AI Conversations** - Chat with Claude about your codebase using the Claude Agent SDK
- **GitHub Integration** - Connect repositories via GitHub App for AI-powered code analysis
- **Team Collaboration** - Multi-user organizations with role-based access (owner/member)
- **Conversation Sharing** - Share conversations via tokens for read-only access
- **Code Review Requests** - Request reviews from team members by sharing conversations
- **Repository Syncing** - Clone and sync repositories for offline analysis

## Tech Stack

- **Frontend**: React 19, React Router 7, TailwindCSS 4
- **Backend**: Node.js 20, React Router Node adapter
- **Database**: PostgreSQL 16 with Drizzle ORM
- **AI**: Claude Agent SDK

## Prerequisites

- Node.js 20+
- PostgreSQL 16+
- GitHub App (for repository access)
- Anthropic API key

## Environment Variables

Create a `.env` file based on `.env.example`:

```
ANTHROPIC_API_KEY=       # Claude API key from console.anthropic.com
DATABASE_URL=            # PostgreSQL connection string
GITHUB_APP_ID=           # GitHub App ID
GITHUB_APP_SLUG=         # GitHub App slug
GITHUB_PRIVATE_KEY=      # GitHub App private key (PEM format)
TOKEN_ENCRYPTION_KEY=    # 32-byte hex string for token encryption
```

## Development

```bash
npm install
npm run db:push
npm run dev
```

The development server runs at `http://localhost:5173`.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Run production server |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run db:migrate` | Run database migrations |
| `npm run db:push` | Push schema changes to database |

## Docker Deployment

```bash
docker compose up -d
```

The Docker setup includes:
- Multi-stage build for optimized images
- PostgreSQL with health checks
- Caddy reverse proxy with automatic SSL
- Automatic database migrations on startup

Required environment variables for Docker:
- `POSTGRES_PASSWORD` - Database password
- `DOMAIN` - Your domain for SSL

See [docs/docker-deployment.md](docs/docker-deployment.md) for detailed deployment instructions.

## Database Schema

The app uses the following tables:

- `users` - User accounts
- `organizations` - Team organizations
- `members` - User-organization membership with roles
- `sessions` - Authentication sessions
- `conversations` - Chat conversations
- `items` - Messages and tool calls within conversations
- `conversationShares` - Share tokens for conversations
- `reviewRequests` - Code review workflow
- `invitations` - Team invitations
- `githubInstallations` - GitHub App installations
- `repositories` - Connected repositories

## Documentation

- [Development Setup](docs/development.md)
- [Docker Deployment](docs/docker-deployment.md)
