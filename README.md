# Talkoot Evals

## Local development

Requirements:
- Node.js and npm

Run locally:

```sh
npm install
npm run dev
```

## Docker

The container runs one Node process that serves both the built React frontend
and the `/api` backend. It is configured for SQL Server by default.

1. Create the SQL Server tables if they do not already exist:

```sh
python db/setup_temp_tables.py
```

2. Prepare runtime environment values:

```sh
cp .env.docker.example .env.docker
```

PowerShell:

```powershell
Copy-Item .env.docker.example .env.docker
```

Fill in `SQL_SERVER_CONNSTRING` and the Azure OpenAI values if you need eval
execution or post-edit routes.

If startup logs mention `your-server.database.windows.net`, `.env.docker` still
contains the example placeholder. Replace it with the real SQL Server connection
string from `.env`.

3. Build and run:

```sh
docker compose --env-file .env.docker up --build
```

Open http://localhost:8000.

Direct Docker usage is also supported:

```sh
docker build -t evalmvp:local .
docker run --rm -p 8000:8000 --env-file .env.docker evalmvp:local
```

## Tech stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
