# Deploying Training Hub — no command line needed

You need three **free** accounts. Two store/run the app; the third (Supabase) is your
database, which you already have.

| Account | What it does |
|---|---|
| **GitHub** | Stores the code |
| **Vercel** | Builds and hosts the live website |
| **Supabase** | The database (already set up) |

> 🔒 **Golden rule:** your database password and the connection strings are secret.
> Only ever paste them into **Supabase** or **Vercel**. Never into chat, email, or any
> public place.

---

## Step 1 — Put the code on GitHub (using a simple app, no typing commands)

1. Create a free account at <https://github.com> (note your username + password).
2. Download and install **GitHub Desktop**: <https://desktop.github.com>
   (it bundles everything — you won't touch a command line).
3. Open GitHub Desktop → **Sign in** with your GitHub account (it opens your browser to confirm).
4. Menu: **File → Add Local Repository…**
5. Choose this project folder:
   `...\Projetos\soalcafoGF`
   - If it warns "this directory does not appear to be a Git repository", click the
     **"create a repository"** link it offers, then **Create Repository**.
6. Click **Publish repository** (top-right). Keep **"Keep this code private"** ticked. Publish.

✅ Your code is now safely on GitHub.

---

## Step 2 — Get your Supabase values ready

1. Open your project at <https://supabase.com>.
2. Click the green **Connect** button at the top.
3. You'll see several connection strings. You need two:
   - **Transaction pooler** (ends in `:6543`) → this becomes **DATABASE_URL**.
     Add this to the very end of it: `?pgbouncer=true&connection_limit=1`
   - **Session pooler** (ends in `:5432`) → this becomes **DIRECT_URL**.
4. Each string contains `[YOUR-PASSWORD]`. Replace that with your database password.
   - Forgot the password? Supabase → **Settings → Database → Reset database password**.
5. Check the region is in **Europe** (Supabase → Settings → General). Important for GDPR.

Keep these two finished strings handy for the next step (paste them into Vercel only).

---

## Step 3 — Deploy on Vercel

1. Go to <https://vercel.com> → **Sign Up** → **Continue with GitHub** (easiest).
2. Click **Add New… → Project**.
3. Find your repository (e.g. `training-hub`) → **Import**.
4. **Before** clicking Deploy, open the **Environment Variables** section and add these four:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your Transaction pooler string (with the `?pgbouncer=...` suffix) |
   | `DIRECT_URL` | your Session pooler string |
   | `AUTH_SECRET` | the random value Claude generated for you |
   | `AUTH_TRUST_HOST` | `true` |

5. Click **Deploy**.

The build takes a few minutes. It automatically creates the database tables in Supabase
and turns on all the security rules — you don't run anything yourself. When it finishes,
Vercel gives you a live link (e.g. `training-hub.vercel.app`).

---

## After it's live

To actually log in, you need a first user. Tell Claude when you reach this point — there
are a couple of easy options (e.g. a one-time seed) and Claude will walk you through it.
