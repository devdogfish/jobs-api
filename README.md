## Development

```bash
npm install
npm run dev          # Persistent Express server (sessions work)
# or
vc dev               # Vercel serverless mode (sessions won't persist)
```

Open http://localhost:3000

## Build & Deploy

```bash
vc build             # Build locally
vc deploy            # Deploy to Vercel
```

## Authentication

The API uses two authentication mechanisms:

### Route Protection

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/` | GET | Public | Health check |
| `/base-resume-pdf` | GET | Public | Base resume PDF |
| `/auth/login` | POST | Public | Login |
| `/auth/logout` | POST | Public | Logout |
| `/auth/session` | GET | Public | Check auth status |
| `/create-resume` | POST | API Key | Generate resume PDF |
| `/render-resume` | POST | API Key | Render supplied Markdown and return the PDF |
| `/base-resume` | GET | API Key | Base resume JSON |
| `/test` | GET | API Key | Test PDF generation |
| `/transcribe-ogg` | POST | API Key | Audio transcription |
| `/job-report` | GET | Session | Daily job report |
| `/job-report-all` | GET | Session | Heatmap calendar data |

### API Key (Backend Services)

Add header `X-API-Key` to requests:

```bash
curl http://localhost:3000/base-resume \
  -H "X-API-Key: your-api-key"
```

`POST /render-resume` takes JSON with `markdown` and an optional `trackingLinks` map from exact source URLs to replacement URLs. Supply the name as the first H1 and the contact line immediately below it. The endpoint uses the Jobs API résumé typography and returns `application/pdf` without an upload.

### Session Auth (Frontend)

Password-only login. Browser handles cookies automatically.

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"your-password"}'

# Check status
curl http://localhost:3000/auth/session

# Access protected routes
curl http://localhost:3000/job-report

# Logout
curl -X POST http://localhost:3000/auth/logout
```

## Environment Variables

Required in `.env`:

```bash
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SUPABASE_BUCKET_NAME=...
SESSION_SECRET=<32-char-random>
SESSION_MAX_AGE_HOURS=24
AUTH_PASSWORD_HASH="<bcrypt-hash>"
API_KEY=<32-char-random>
```

Generate password hash:
```bash
node -e "console.log(require('bcryptjs').hashSync('password', 10))"
```

Optional production `RENDER_API_KEY` grants access only to `POST /render-resume`. The existing `API_KEY` continues to authenticate its current routes, including rendering.
