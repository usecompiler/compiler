# Compiler

An AI-powered tool that helps non-technical teams get answers about how an app works without needing to ask engineers.

<p align="center">
  <img
    src="https://github.com/user-attachments/assets/da1e08d7-a280-4c60-bbbe-9f0e313f0148"
    alt="Compiler example reading the Basecamp Fizzy repo"
    width="700"
  />
</p>

<p align="center">
  <em>
    Compiler answering questions about the
    <a href="https://github.com/basecamp/fizzy" target="_blank">Basecamp Fizzy codebase</a>
  </em>
</p>

## Stack

- **Frontend**: React 19, React Router 7, TailwindCSS 4
- **Backend**: Node.js 20, React Router Node adapter
- **Database**: PostgreSQL 16 with Drizzle ORM

## Environment Variables

Create a `.env` file based on `.env.example`:

```
DATABASE_URL=            # PostgreSQL connection string
TOKEN_ENCRYPTION_KEY=    # 32-byte hex string for credential encryption
```

## Development

```bash
npm install
npm run db:push
npm run dev
```

The development server runs at `http://localhost:5173`.

### Available Scripts

| Script               | Description                     |
| -------------------- | ------------------------------- |
| `npm run dev`        | Start development server        |
| `npm run build`      | Build for production            |
| `npm run start`      | Run production server           |
| `npm run typecheck`  | Run TypeScript type checking    |
| `npm run db:migrate` | Run database migrations         |
| `npm run db:push`    | Push schema changes to database |

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

## Documentation

- [Development Setup](docs/development.md)
- [Docker Deployment](docs/docker-deployment.md)
