# Development Setup

## Getting Started (Dev Container)

The easiest way to get started is using a Dev Container, which provides a fully configured development environment with all dependencies.

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/usecompiler/compiler.git
   cd compiler
   ```

2. Create a `.env` file:

   ```bash
   cp .env.example .env
   ```

3. Configure your `.env` with:
   - AI provider (choose one):
     - `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com/)
     - OR AWS Bedrock credentials (see AI Provider Configuration below)
   - GitHub App credentials (see [docker-deployment.md](./docker-deployment.md#creating-a-github-app))
   - `TOKEN_ENCRYPTION_KEY` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

4. Open in your Dev Container tool of choice

5. The dev server starts automatically. Open [http://localhost:5173](http://localhost:5173)

## Scripts

| Command              | Description                     |
| -------------------- | ------------------------------- |
| `npm run dev`        | Start development server        |
| `npm run build`      | Build for production            |
| `npm run start`      | Run production server           |
| `npm run typecheck`  | Run TypeScript type checking    |
| `npm run db:migrate` | Run database migrations         |
| `npm run db:push`    | Push schema changes to database |

## AI Provider Configuration

The app supports two AI providers:

### Anthropic API (Default)

Set `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com/)

### AWS Bedrock (Alternative)

To use AWS Bedrock instead of the Anthropic API:

1. Set `CLAUDE_CODE_USE_BEDROCK=1`
2. Set `AWS_REGION` (e.g., `us-east-1`)
3. Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

Optional Bedrock settings:
- `ANTHROPIC_MODEL` - Override the default model (e.g., `us.anthropic.claude-sonnet-4-5-20250929-v1:0`)
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` - Recommended: `4096` for Bedrock

## Running Without Docker

If you prefer to run outside of a container:

### Prerequisites

- Node.js 20+
- PostgreSQL 16+

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure `DATABASE_URL` in your `.env` pointing to your PostgreSQL instance

3. Run database migrations:

   ```bash
   npm run db:migrate
   ```

4. Start the dev server:
   ```bash
   npm run dev
   ```
