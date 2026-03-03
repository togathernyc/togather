# Community Subdomains

This guide explains how community subdomains work and how to set up a new subdomain when onboarding a community.

## Overview

Community subdomains allow each community to have their own branded URL:
- `fount.{your-domain}` → Fount community
- `demo-community.{your-domain}` → Demo Community

When users visit `{subdomain}.{your-domain}/nearme`, they see a public "Find Groups Near Me" page filtered to that community.

## How It Works

### Architecture

```
User visits fount.{your-domain}/nearme
         ↓
DNS: *.{your-domain} → origin.expo.app (wildcard CNAME)
         ↓
Expo Hosting: Routes to deployment alias "fount"
         ↓
Frontend: useSubdomainCommunity hook parses "fount" from hostname
         ↓
Backend API: communitySearchBySubdomain({ subdomain: "fount" })
         ↓
Database: Finds community where subdomain = "fount"
```

### Key Components

1. **DNS (already configured)**
   - Wildcard CNAME: `*.{your-domain} → origin.expo.app`
   - Specific records for API subdomain (Fly.io) remain unchanged

2. **Expo Hosting**
   - Each subdomain requires a **deployment alias** with matching name
   - Aliases point to the same web app deployment

3. **Frontend Code**
   - `apps/mobile/features/auth/hooks/useSubdomainCommunity.ts` - Parses subdomain from hostname
   - `apps/mobile/app/(landing)/nearme/index.tsx` - Public nearme page

4. **Backend API**
   - `communitySearchBySubdomain` procedure in `apps/api-trpc/src/routers/resources.ts`

5. **Database**
   - `community.subdomain` column stores the subdomain slug

## Setting Up a New Community Subdomain

### Prerequisites

- Community must exist in the database
- Community must have a `subdomain` value set (e.g., "fount")
- You must be logged in to EAS CLI (`npx eas-cli login`)

### Step 1: Set the Subdomain in Database

Ensure the community has a subdomain set in the database:

```sql
UPDATE community SET subdomain = 'my-community' WHERE id = 123;
```

Or via admin interface if available.

### Step 2: Deploy with the Alias

From the `apps/mobile` directory:

```bash
cd apps/mobile
npx eas-cli deploy --alias my-community --non-interactive
```

This creates a deployment alias that routes `my-community.{your-domain}` to the web app.

### Step 3: Verify

Visit `https://my-community.{your-domain}/nearme` to confirm it works.

## Managing Aliases

### List All Deployments

View deployments and aliases in the Expo dashboard:
- Go to [expo.dev](https://expo.dev)
- Navigate to your project → **Hosting** → **Deployments**

### Delete an Alias

If you need to remove a subdomain:

```bash
npx eas-cli deploy:alias:delete --alias my-community
```

### Assign Alias to Different Deployment

To point an alias to a specific deployment:

```bash
npx eas-cli deploy:alias --alias my-community --id <deployment-id>
```

## Deploying Web Updates

When deploying web changes, use the unified deploy script that updates all subdomains at once:

```bash
cd apps/mobile

# Preview deployment
pnpm deploy:web

# Production deployment
pnpm deploy:web:prod
```

This script:
1. Builds the web app with production tRPC URL
2. Deploys once to get a deployment ID
3. Updates all subdomain aliases to point to the same deployment

To add a new subdomain alias, edit `scripts/deploy-web-all.sh` and add it to the `ALIASES` array.

## Current Active Subdomains

| Subdomain | Community | URL Pattern |
|-----------|-----------|-------------|
| `fount` | Fount | https://fount.{your-domain}/nearme |
| `demo-community` | Demo Community | https://demo-community.{your-domain}/nearme |

## Troubleshooting

### "No worker deployment was found matching the current domain"

**Cause**: The subdomain doesn't have a corresponding Expo deployment alias.

**Solution**: Run `npx eas-cli deploy --alias <subdomain>` to create the alias.

### Subdomain shows wrong community or 404

**Cause**: The subdomain doesn't match any community's `subdomain` field in the database.

**Solution**: Check the database and ensure `community.subdomain` matches exactly (case-sensitive).

### DNS not resolving

**Cause**: DNS propagation or misconfiguration.

**Solution**:
1. Verify `*.{your-domain}` CNAME points to `origin.expo.app`
2. Wait for DNS propagation (can take up to 48 hours)
3. Test with `dig <subdomain>.{your-domain}`

## Automation Ideas

For high-volume community onboarding, consider:

1. **Admin Trigger**: Add a button in admin UI that calls an API endpoint
2. **API Endpoint**: Creates the EAS alias via EAS API or CLI
3. **Webhook**: Trigger deployment when community subdomain is set

Example script for batch deployment:

```bash
#!/bin/bash
# deploy-subdomain.sh

SUBDOMAIN=$1

if [ -z "$SUBDOMAIN" ]; then
  echo "Usage: ./deploy-subdomain.sh <subdomain>"
  exit 1
fi

cd apps/mobile
npx eas-cli deploy --alias "$SUBDOMAIN" --non-interactive
echo "Deployed: https://$SUBDOMAIN.{your-domain}"
```

## Related Documentation

- [EAS Web Deployment](./EAS_WEB_DEPLOYMENT.md) - General web deployment guide
- [EAS Hosting Custom Domains](https://docs.expo.dev/eas/hosting/custom-domain/) - Official Expo docs
- [NearMe Feature Summary](../features/nearme-feature-summary.md) - Feature implementation details
