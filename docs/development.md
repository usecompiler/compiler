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
   - `TOKEN_ENCRYPTION_KEY` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

4. Open in your Dev Container tool of choice

5. The dev server starts automatically. Open [http://localhost:5173](http://localhost:5173)

6. Complete the onboarding flow to configure:
   - AI provider (Anthropic API or AWS Bedrock)
   - GitHub App credentials

## Scripts

| Command              | Description                     |
| -------------------- | ------------------------------- |
| `npm run dev`        | Start development server        |
| `npm run build`      | Build for production            |
| `npm run start`      | Run production server           |
| `npm run typecheck`  | Run TypeScript type checking    |
| `npm run db:migrate` | Run database migrations         |
| `npm run db:push`    | Push schema changes to database |

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
