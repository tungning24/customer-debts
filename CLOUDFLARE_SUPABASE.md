# Cloudflare + Supabase setup

## 1. Create Supabase tables

Open Supabase Dashboard > SQL Editor and run `supabase-schema.sql`.

The Cloudflare Function uses `SUPABASE_SERVICE_ROLE_KEY`, so browser users do not need direct table policies. Keep Row Level Security enabled.

## 2. Configure Cloudflare Pages

In Cloudflare Dashboard:

1. Go to Workers & Pages.
2. Create application > Pages > Connect to Git.
3. Select this GitHub repository.
4. Use these build settings:
   - Framework preset: None
   - Build command: leave blank
   - Build output directory: `/`

## 3. Add environment variables

In the Pages project settings, add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_KEY`

Use the same `ADMIN_KEY` that you type in the web app header.

## 4. Deploy

Push the repo to GitHub. Cloudflare Pages will deploy the static files and the function at:

```text
/api/debts
```

The app now calls that endpoint instead of Google Apps Script.
