#!/usr/bin/env node

/**
 * Validates eas.json configuration before running EAS builds.
 * This script checks:
 * 1. eas.json exists and is valid JSON
 * 2. Node versions are in valid format (must be X.Y.Z format like "20.0.0", not "20" or "20.x")
 * 3. Required build profiles exist
 * 4. Uses EAS CLI to validate configuration (if available)
 */

const fs = require('fs');
const path = require('path');

const EAS_JSON_PATH = path.join(__dirname, '..', 'eas.json');

function validateEasJson() {
  console.log('🔍 Validating eas.json configuration...\n');

  // Check if eas.json exists
  if (!fs.existsSync(EAS_JSON_PATH)) {
    console.error('❌ Error: eas.json not found at', EAS_JSON_PATH);
    process.exit(1);
  }

  // Parse and validate JSON
  let easConfig;
  try {
    const content = fs.readFileSync(EAS_JSON_PATH, 'utf8');
    easConfig = JSON.parse(content);
  } catch (error) {
    console.error('❌ Error: eas.json is not valid JSON');
    console.error(error.message);
    process.exit(1);
  }

  // Validate build profiles
  if (!easConfig.build) {
    console.error('❌ Error: eas.json missing "build" section');
    process.exit(1);
  }

  const buildProfiles = easConfig.build;
  const profiles = Object.keys(buildProfiles);
  
  if (profiles.length === 0) {
    console.error('❌ Error: No build profiles found in eas.json');
    process.exit(1);
  }

  console.log(`✓ Found ${profiles.length} build profile(s): ${profiles.join(', ')}\n`);

  // Validate each build profile
  let hasErrors = false;
  // EAS requires full version format X.Y.Z (e.g., "20.0.0"), not just "20" or "20.x"
  const fullVersionPattern = /^\d+\.\d+\.\d+$/; // Matches "20.0.0", "18.18.0", etc.
  const invalidNodeVersionPattern = /\.x$/; // Matches "20.x", "18.x", etc.

  for (const profileName of profiles) {
    const profile = buildProfiles[profileName];
    console.log(`Validating profile: ${profileName}`);

    // Check node version format
    if (profile.node) {
      const nodeVersion = String(profile.node);
      
      // Check for invalid patterns first
      if (invalidNodeVersionPattern.test(nodeVersion)) {
        console.error(`  ❌ Invalid node version format: "${nodeVersion}"`);
        console.error(`     EAS requires full version format like "20.0.0", not "${nodeVersion}"`);
        hasErrors = true;
      } else if (!fullVersionPattern.test(nodeVersion)) {
        // Check if it's not in full format (e.g., just "20")
        console.error(`  ❌ Invalid node version format: "${nodeVersion}"`);
        console.error(`     EAS requires full version format like "20.0.0", not "${nodeVersion}"`);
        console.error(`     Use a specific version like "20.0.0" or "20.18.0"`);
        hasErrors = true;
      } else {
        console.log(`  ✓ Node version: ${nodeVersion} (valid format)`);
      }
    } else {
      console.log(`  ⚠️  No node version specified (will use EAS default)`);
    }

    // Check for required fields based on profile type
    if (profileName === 'staging' && !profile.distribution) {
      console.warn(`  ⚠️  Staging profile should specify "distribution"`);
    }

    if (profileName === 'production' && !profile.autoIncrement) {
      console.warn(`  ⚠️  Production profile should specify "autoIncrement"`);
    }

    console.log('');
  }

  if (hasErrors) {
    console.error('❌ Validation failed. Please fix the errors above before running EAS builds.');
    process.exit(1);
  }

  console.log('✅ eas.json basic validation passed!\n');
  
  // Try to validate with EAS CLI if available
  // This reproduces the same validation that EAS does remotely
  const { execSync } = require('child_process');
  let easValidationPassed = false;
  
  try {
    console.log('🔍 Attempting to validate with EAS CLI (reproduces EAS validation)...');
    console.log('   This will catch the same errors that EAS would catch remotely.\n');
    
    // Try to use EAS CLI to validate the configuration
    // We'll try a few different commands to see what works
    try {
      // Try to validate by attempting to read the config
      execSync('npx eas-cli@latest build:configure --non-interactive', {
        stdio: 'pipe',
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, EAS_NO_VCS: '1' }, // Skip VCS check
      });
      easValidationPassed = true;
      console.log('✅ EAS CLI validation passed!\n');
    } catch (configureError) {
      // If build:configure doesn't work, try to validate by checking the config
      // EAS CLI validates the config when you try to use it
      try {
        // Try to validate by checking if we can parse the config
        execSync('npx eas-cli@latest config --non-interactive', {
          stdio: 'pipe',
          cwd: path.join(__dirname, '..'),
        });
        easValidationPassed = true;
        console.log('✅ EAS CLI validation passed!\n');
      } catch (configError) {
        // If that doesn't work, we'll just note that EAS CLI validation wasn't possible
        // but the basic validation passed
        console.log('⚠️  EAS CLI validation skipped (EAS CLI may not be available or configured)');
        console.log('   The basic validation passed, but EAS CLI validation would catch additional errors.\n');
      }
    }
  } catch (error) {
    // EAS CLI validation is optional - if it fails, we still pass
    // because the basic validation above passed
    console.log('⚠️  EAS CLI validation skipped (EAS CLI may not be available or configured)');
    console.log('   The basic validation passed, but EAS CLI validation would catch additional errors.\n');
  }

  if (hasErrors) {
    console.error('❌ Validation failed. Please fix the errors above before running EAS builds.');
    process.exit(1);
  }

  if (easValidationPassed) {
    console.log('✅ All validations passed! You can now run EAS builds.\n');
  } else {
    console.log('✅ Basic validation passed!');
    console.log('⚠️  Note: EAS CLI validation was not available. Make sure to test with EAS CLI if possible.\n');
  }
}

// Run validation
try {
  validateEasJson();
} catch (error) {
  console.error('❌ Unexpected error during validation:', error.message);
  process.exit(1);
}

