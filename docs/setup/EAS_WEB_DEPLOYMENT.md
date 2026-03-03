# EAS Web Deployment Guide

## Overview

EAS Hosting provides a simple way to deploy your Expo web app without the complexities of Android and iOS distribution. This guide covers how to set up and use EAS for web deployment.

## Why EAS Web Deployment?

- **No App Store Hassles**: Deploy directly to the web without dealing with Google Play or App Store approval processes
- **Fast Iteration**: Deploy updates instantly without waiting for app store reviews
- **Easy Sharing**: Share preview URLs instantly with stakeholders
- **Automatic Deployments**: Set up workflows to deploy automatically on push

## Prerequisites

1. **EAS Project**: Your project must be initialized with EAS (already done if you've set up mobile builds)
2. **Expo Account**: Sign in to your Expo account
3. **Web Configuration**: Your `app.json` should have web configuration (already configured)

## Configuration

### 1. EAS Configuration (`eas.json`)

Web deployment is configured in your `eas.json` file. Both `preview` and `production` profiles include web configuration:

```json
{
  "build": {
    "preview": {
      "web": {
        "output": "static"
      }
    },
    "production": {
      "web": {
        "output": "static"
      }
    }
  }
}
```

### 2. App Configuration (`app.json`)

Your `app.json` includes web configuration:

```json
{
  "expo": {
    "web": {
      "favicon": "./assets/favicon.png",
      "bundler": "metro",
      "output": "static"
    }
  }
}
```

## Manual Deployment

### Deploy Preview (Staging)

Deploy a preview version of your web app:

```bash
cd apps/mobile
npm run deploy:web
# Or directly:
npx eas-cli@latest deploy --platform web
```

This will:
- Build your web app
- Deploy it to a preview subdomain
- Provide you with a preview URL

**First Time**: You'll be prompted to select a preview subdomain for your project.

### Deploy Production

Deploy to production:

```bash
cd apps/mobile
npm run deploy:web:prod
# Or directly:
npx eas-cli@latest deploy --platform web --prod
```

This will:
- Build your web app
- Deploy it to your production domain
- Make it accessible via your production URL

## Automatic Deployment with Workflows

Two workflow files have been created for automatic web deployment:

### 1. Staging Web Deploy (`.eas/workflows/staging-web-deploy.yml`)

Automatically deploys web app when you push to `staging` branch:
- Deploys to preview environment
- Perfect for testing changes before production

### 2. Main Web Deploy (`.eas/workflows/main-web-deploy.yml`)

Automatically deploys web app when you push to `main` branch:
- Deploys to production environment
- Your live web app

## How Workflows Work

### Automatic Triggers

When you push commits to:
- **`staging`** → Automatically deploys web app to preview
- **`main`** → Automatically deploys web app to production

### Manual Triggers

You can also manually trigger workflows:

```bash
cd apps/mobile
npx eas-cli@latest workflow:run staging-web-deploy.yml
npx eas-cli@latest workflow:run main-web-deploy.yml
```

### Viewing Deployments

1. Go to [expo.dev](https://expo.dev)
2. Navigate to your project
3. Click on **Hosting** to see all web deployments
4. Click on **Workflows** to see workflow runs

## Accessing Your Web App

### URL Format

EAS Hosting uses a specific URL format based on your project subdomain:

**Preview Deployments:**
```
https://<subdomain>--<deployment-id>.expo.app/
```

Each preview deployment gets a unique deployment ID. For example:
- `https://togather--abc123def456.expo.app/`
- `https://togather--xyz789ghi012.expo.app/`

**Production Deployments:**
```
https://<subdomain>.expo.app/
```

Production deployments use a consistent URL. For example:
- `https://togather.expo.app/`

**First Time Setup:**
When you deploy for the first time, EAS will prompt you to select a preview subdomain. This subdomain is used for both preview and production URLs. Based on your `app.json`, your slug is `togather`, so your URLs will likely be:
- Preview: `https://togather--<deployment-id>.expo.app/`
- Production: `https://togather.expo.app/`

### Preview Deployments

After deploying to preview:
1. Go to your project on expo.dev
2. Navigate to **Hosting** → **Deployments**
3. Find your preview deployment
4. Click on the preview URL to access your app
5. Each deployment has a unique URL with a deployment ID

### Production Deployments

After deploying to production:
1. Go to your project on expo.dev
2. Navigate to **Hosting** → **Deployments**
3. Find your production deployment
4. Access your app via the production URL (consistent URL without deployment ID)

## Custom Domains

You can configure custom domains for your web app:

1. Go to your project on [expo.dev](https://expo.dev)
2. Navigate to **Hosting** → **Domains**
3. Add your custom domain
4. Follow the DNS configuration instructions

## Troubleshooting

### Deployment Fails

1. **Check Build Locally**: Test that your web app builds locally first:
   ```bash
   cd apps/mobile
   npm run build
   ```

2. **Check Logs**: View deployment logs on expo.dev:
   - Go to your project → **Hosting** → **Deployments**
   - Click on the failed deployment to see logs

3. **Verify Configuration**: Ensure `app.json` and `eas.json` are correctly configured

### Workflows Not Triggering

1. **Check GitHub Integration**: Ensure repository is linked in Expo dashboard
2. **Check Branch Names**: Workflows only trigger on `main` and `staging`
3. **Check Workflow Files**: Verify `.eas/workflows/*.yml` files exist and are committed
4. **Check EAS Project**: Ensure `app.json` has a valid `projectId`

### Authentication Issues

If you see authentication errors:

```bash
cd apps/mobile
npx eas-cli@latest login
```

Or set an environment variable for CI/CD:

```bash
export EXPO_TOKEN=your-token-here
```

## Comparison: Web vs Mobile Deployment

| Feature | Web Deployment | Mobile Deployment |
|---------|---------------|-------------------|
| **Speed** | Instant deployment | Requires build time |
| **Distribution** | Direct URL access | App stores or internal distribution |
| **Updates** | Instant updates | Requires app store approval (iOS) |
| **Sharing** | Share URL directly | Requires app installation |
| **Testing** | Open in browser | Requires device/emulator |

## Best Practices

1. **Test Locally First**: Always test your web app locally before deploying:
   ```bash
   npm run web
   ```

2. **Use Staging for Testing**: Deploy to staging first to test changes before production

3. **Monitor Deployments**: Check deployment logs regularly to catch issues early

4. **Version Control**: Keep your workflow files in version control

5. **Environment Variables**: Use environment variables for different environments (preview vs production)

## Next Steps

1. ✅ Deploy your first preview: `npm run deploy:web`
2. ✅ Push to `staging` to test automatic deployment
3. ✅ Push to `main` to deploy to production
4. ✅ Configure custom domain (optional)
5. ✅ Share your web app URL with users

## Additional Resources

- [EAS Hosting Documentation](https://docs.expo.dev/deploy/web/)
- [EAS Workflows Documentation](https://docs.expo.dev/eas/workflows/get-started/)
- [EAS Hosting Workflows](https://docs.expo.dev/eas/hosting/workflows/)

