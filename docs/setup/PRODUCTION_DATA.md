# Pulling Production Data for Local Development

This guide explains how to pull production data from Fly.io Postgres to your local development environment.

## Quick Start

**From root directory:**
```bash
pnpm pull-data
```

**From backend directory:**
```bash
cd apps/backend
pnpm pull-data
```

## What It Does

The `pull-production-data.sh` script:

1. ✅ Checks that `flyctl` CLI is installed and Docker is running
2. ✅ Ensures local Postgres container is running (starts it if needed)
3. ✅ Automatically starts a `togather-api` Fly machine (if none are running) so it can read the real `PG_*` secrets straight from the app environment
4. ✅ Finds the latest automatic backup from Fly.io Postgres (Fly.io creates backups automatically)
5. ✅ Downloads the backup to `apps/backend/data/postgres-snapshots/` with live progress using `pv`
6. ✅ Terminates any existing local DB sessions, drops the database, restores the production snapshot, and runs migrations
7. ✅ Keeps the dump files out of git (`apps/backend/data/postgres-snapshots/` is ignored)

## Prerequisites

1. **Fly.io CLI installed:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Logged into Fly.io:**
   ```bash
   flyctl auth login
   ```

3. **Docker Desktop running** (for local Postgres)

4. **Backend setup completed:**
   ```bash
   cd apps/backend
   pnpm setup
   ```

## Workflow

### First Time Setup

1. **Set up backend environment:**
   ```bash
   cd apps/backend
   pnpm setup
   ```
   This will ask if you want to pull production data.

2. **If you skipped it, pull data now:**
   ```bash
   pnpm pull-data
   ```

### Regular Development

**Pull fresh production data:**
```bash
# From root
pnpm pull-data

# Or from backend
cd apps/backend
pnpm pull-data
```

**Start development with local backend:**
```bash
pnpm dev --local
```

This will:
- Use your local Postgres with production data
- Start backend API
- Start mobile app connected to local backend

## Backup Files

Backups are stored in:
```
apps/backend/data/postgres-snapshots/latest-YYYYMMDD-HHMMSS.dump
```

Each backup is timestamped, so you can keep multiple versions if needed.

## Troubleshooting

### "flyctl is not installed"
```bash
curl -L https://fly.io/install.sh | sh
```

### "Failed to list backups"
Make sure you're logged in:
```bash
flyctl auth login
```

### "Docker is not running"
Start Docker Desktop and try again.

### "Postgres failed to start"
Check Docker Desktop is running and has enough resources allocated.

### "No backups found"
Create a backup manually (if needed):
```bash
flyctl mpg backup create -a <your-cluster-name>
```

Then run `pnpm pull-data` again.

### Getting Database Password

The script needs database credentials to create the dump. You have several options:

> **Note:** The script will try this automatically. If a machine isn’t running, it auto-starts one, waits for it to boot, and then grabs the credentials.

**Option 1: Get password from app manually (if app is running)**
```bash
# SSH into the app and get the password
flyctl ssh console -a togather-api
# Then inside the container:
echo $PG_PASSWORD
# Copy the password and exit
```

**Option 2: Reset the fly-user password**
```bash
# This will show you a new password
flyctl mpg users reset-password fly-user 1zvn90kjggprkpew
```

**Option 3: Use environment variables**
```bash
export PG_USER=fly-user
export PG_PASSWORD=your-password-here
export PG_NAME=fly-db
pnpm pull-data
```

**Option 4: Let the script prompt you**
Just run `pnpm pull-data` and it will prompt for the password interactively.

### Finding Your Postgres Cluster Name
List your managed Postgres clusters:
```bash
flyctl mpg list --org togather
```

The script automatically finds the cluster in the `togather` organization.

### Restore Errors

If you see errors during restore:
- The backup might be corrupted - try creating a new backup
- Check that Postgres container has enough disk space
- Make sure migrations are up to date: `cd apps/backend && pnpm migrate`

## Best Practices

1. **Pull fresh data regularly** - Especially before working on features that depend on specific data
2. **Pull before major changes** - Ensures you're testing with realistic data
3. **Keep backups** - The script saves timestamped backups, useful for debugging
4. **Don't modify production data** - Always work with local copies

## Integration with Dev Workflow

The `--local` flag automatically uses your local database:

```bash
# Start everything with local backend (uses local Postgres with production data)
pnpm dev --local
```

This is the recommended workflow for:
- Testing with real production data
- Debugging production issues locally
- Developing features that need specific data

## Alternative: Use Production Backend

If you don't need local data, you can connect directly to production:

```bash
# Uses production backend (no local data needed)
pnpm dev
```

This is faster for frontend-only development.

