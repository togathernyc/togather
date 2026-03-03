# Setting Up New Private GitHub Repository

## Step 1: Create New Private Repository on GitHub

1. Go to [GitHub](https://github.com) and sign in
2. Click the **+** icon in the top right → **New repository**
3. Repository name: `togather-monorepo` (or your preferred name)
4. Description: "Togather monorepo - Backend API and cross-platform mobile app"
5. Set to **Private**
6. **DO NOT** initialize with README, .gitignore, or license (we already have these)
7. Click **Create repository**

## Step 2: Initialize Git Repository (if not already initialized)

If you haven't initialized git in this directory yet:

```bash
cd /path/to/your/project
git init
```

## Step 3: Add All Files and Commit

```bash
# Add all files including the new EAS configuration
git add .

# Commit everything
git commit -m "Initial commit: Monorepo with EAS Workflows setup"
```

## Step 4: Add Remote and Push

```bash
# Add the new repository as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/togather-monorepo.git

# Or if using SSH:
# git remote add origin git@github.com:YOUR_USERNAME/togather-monorepo.git

# Push to main branch
git branch -M main
git push -u origin main
```

## Step 5: Create Staging Branch

```bash
# Create and push staging branch
git checkout -b staging
git push -u origin staging

# Switch back to main
git checkout main
```

## Step 6: Link Repository to EAS

1. Go to [expo.dev](https://expo.dev) and sign in
2. Navigate to your project (Togather)
3. Go to **Project Settings** → **GitHub**
4. Click **Install GitHub App** (if not already installed)
5. Select your new repository: `YOUR_USERNAME/togather-monorepo`
6. Connect the repository

## Step 7: Verify Setup

After linking, workflows will automatically trigger when you push to `main` or `staging` branches.

To test:
```bash
# Make a small change
echo "# Test" >> README.md
git add README.md
git commit -m "Test workflow trigger"
git push origin staging
```

Then check [expo.dev](https://expo.dev) → Your Project → Workflows to see if the build started.

## Files to Commit

Make sure these files are committed:
- ✅ `apps/mobile/eas.json` - EAS build configuration
- ✅ `apps/mobile/app.json` - Updated with projectId
- ✅ `apps/mobile/.eas/workflows/staging-preview-builds.yml` - Staging workflow
- ✅ `apps/mobile/.eas/workflows/main-production-builds.yml` - Main workflow
- ✅ `docs/setup/EAS_WORKFLOWS_SETUP.md` - Documentation

## Important Notes

- The `.eas/workflows/` directory must be committed to the repository for workflows to work
- Workflows only trigger on pushes to `main` and `staging` branches
- Make sure you've run `eas init` and the `projectId` is in `app.json` before linking GitHub

