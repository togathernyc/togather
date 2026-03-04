#!/usr/bin/env tsx
/**
 * Staging Data Sync Script
 *
 * Copies production database to staging with PII sanitization.
 * Users in the allowlist keep their real contact info for notification testing.
 *
 * Usage:
 *   pnpm sync-staging-data
 *   pnpm sync-staging-data --dry-run  # Preview without applying
 *
 * Environment variables required:
 *   - PROD_DATABASE_URL: Production database connection string
 *   - STAGING_DATABASE_URL: Staging database connection string
 *
 * Configuration:
 *   - Edit ALLOWLISTED_PHONES below to keep real data for specific users
 */

import { execSync, execFileSync, spawn } from "child_process";
import { createWriteStream, unlinkSync, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { createGunzip, createGzip } from "zlib";
import { createReadStream } from "fs";
import * as readline from "readline";

// ==========================================
// CONFIGURATION
// ==========================================

/**
 * Phone numbers to keep real data for (for notification testing).
 * These users will NOT have their PII sanitized.
 * Format: E.164 without the + prefix (e.g., "12025550123")
 */
const ALLOWLISTED_PHONES = [
  // Add phone numbers here that should keep real data
  // Format: E.164 without the + prefix
  "12025550123", // Test user - see CLAUDE.md for credentials
  "15550001001", // Additional test user (replace with real number from secrets manager)
  "15550001002", // Additional test user (replace with real number from secrets manager)
  "15550001003", // Additional test user (replace with real number from secrets manager)
];

/**
 * Tables that contain PII and need sanitization.
 * Note: Table is named "user" (singular) in the database.
 */
const TABLES_WITH_PII = {
  user: {
    phone: (userId: string) => `+1555${userId.slice(-7).padStart(7, "0")}`,
    email: (userId: string) => `user-${userId.slice(0, 8)}@staging.togather.test`,
    // Keep: name, profile_image, created_at, etc.
  },
};

// ==========================================
// MAIN SCRIPT
// ==========================================

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isVerbose = args.includes("--verbose");

function log(message: string) {
  console.log(`[sync-staging] ${message}`);
}

function verbose(message: string) {
  if (isVerbose) {
    console.log(`[sync-staging:verbose] ${message}`);
  }
}

function error(message: string) {
  console.error(`[sync-staging:error] ${message}`);
}

async function main() {
  log("Starting staging data sync...");

  if (isDryRun) {
    log("DRY RUN MODE - no changes will be made");
  }

  // Validate environment
  const prodDbUrl = process.env.PROD_DATABASE_URL;
  const stagingDbUrl = process.env.STAGING_DATABASE_URL;

  if (!prodDbUrl) {
    error("PROD_DATABASE_URL environment variable is required");
    process.exit(1);
  }

  if (!stagingDbUrl) {
    error("STAGING_DATABASE_URL environment variable is required");
    process.exit(1);
  }

  // CRITICAL: Verify prod and staging URLs are different to prevent data corruption
  if (prodDbUrl === stagingDbUrl) {
    error("CRITICAL: PROD_DATABASE_URL and STAGING_DATABASE_URL are identical!");
    error("This would corrupt production data. Aborting.");
    process.exit(1);
  }

  // Additional safety check: ensure prod and staging are different databases
  // Note: Supabase's shared pooler architecture means different databases may share
  // the same hostname (e.g., aws-0-us-west-2.pooler.supabase.com), but they'll have
  // different usernames (containing project references) and potentially different ports
  const prodUrl = new URL(prodDbUrl);
  const stagingUrl = new URL(stagingDbUrl);

  // Compare the full connection identity: user@host:port
  const prodIdentity = `${prodUrl.username}@${prodUrl.hostname}:${prodUrl.port || '5432'}`;
  const stagingIdentity = `${stagingUrl.username}@${stagingUrl.hostname}:${stagingUrl.port || '5432'}`;

  if (prodIdentity === stagingIdentity) {
    error("CRITICAL: Production and staging database connections are identical!");
    error(`Both use: ${prodUrl.hostname}:${prodUrl.port || '5432'} with same user`);
    error("This could indicate a misconfiguration. Aborting.");
    process.exit(1);
  }

  // Log connection info for debugging (without sensitive data)
  verbose(`Production: ${prodUrl.username.slice(0, 15)}...@${prodUrl.hostname}:${prodUrl.port || '5432'}`);
  verbose(`Staging: ${stagingUrl.username.slice(0, 15)}...@${stagingUrl.hostname}:${stagingUrl.port || '5432'}`);

  const dumpFile = `/tmp/togather-staging-dump-${Date.now()}.sql`;
  const sanitizedFile = `/tmp/togather-staging-sanitized-${Date.now()}.sql`;

  try {
    // Step 1: Dump production database
    log("Step 1/4: Dumping production database...");
    await dumpDatabase(prodDbUrl, dumpFile);

    // Step 2: Sanitize PII
    log("Step 2/4: Sanitizing PII...");
    await sanitizeDump(dumpFile, sanitizedFile);

    // SECURITY: Always delete unsanitized dump immediately after sanitization
    // This file contains real PII and should not be left on disk
    if (existsSync(dumpFile)) {
      unlinkSync(dumpFile);
      verbose("Deleted unsanitized dump file");
    }

    if (isDryRun) {
      log("Step 3/4: [SKIPPED - dry run] Would restore to staging");
      log("Step 4/4: [SKIPPED - dry run] Would verify restoration");
      log("\nDry run complete. Sanitized dump available at: " + sanitizedFile);
      log("(Unsanitized production dump has been securely deleted)");
    } else {
      // Step 3: Restore to staging
      log("Step 3/4: Restoring to staging database...");
      await restoreDatabase(stagingDbUrl, sanitizedFile);

      // Step 4: Verify
      log("Step 4/4: Verifying restoration...");
      await verifyRestoration(stagingDbUrl);
    }

    // Cleanup sanitized file (unsanitized dump was already deleted above)
    if (!isDryRun) {
      log("Cleaning up temporary files...");
      if (existsSync(sanitizedFile)) unlinkSync(sanitizedFile);
    }

    log("✅ Staging data sync complete!");
  } catch (err) {
    error(`Sync failed: ${err}`);
    process.exit(1);
  }
}

async function dumpDatabase(dbUrl: string, outputFile: string): Promise<void> {
  verbose(`Dumping to ${outputFile}`);

  // Use pg_dump to create a SQL dump
  // Using execFileSync with args array to avoid shell metacharacter issues with passwords
  // --schema=public: Only dump the public schema (our app tables), not Supabase system schemas
  // --clean: Include DROP statements before CREATE
  // --if-exists: Use IF EXISTS with DROP statements
  // --no-owner: Don't include ownership commands
  // --no-privileges: Don't include GRANT/REVOKE
  const args = [
    dbUrl,
    "--schema=public",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "-f",
    outputFile,
  ];

  try {
    execFileSync("pg_dump", args, { stdio: isVerbose ? "inherit" : "pipe" });
  } catch (err) {
    throw new Error(`pg_dump failed: ${err}`);
  }

  verbose(`Dump complete: ${outputFile}`);
}

async function sanitizeDump(
  inputFile: string,
  outputFile: string
): Promise<void> {
  verbose(`Sanitizing ${inputFile} -> ${outputFile}`);

  const input = createReadStream(inputFile, { encoding: "utf-8" });
  const output = createWriteStream(outputFile, { encoding: "utf-8" });

  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  let inCopyBlock = false;
  let currentTable = "";
  let columnOrder: string[] = [];
  let linesProcessed = 0;
  let linesSanitized = 0;

  for await (const line of rl) {
    linesProcessed++;

    // Detect COPY statements for tables with PII
    // Note: Table is named "user" (singular, quoted because it's a reserved word)
    if (line.startsWith('COPY public."user" ')) {
      inCopyBlock = true;
      currentTable = "user";
      // Extract column order from COPY statement
      // Format: COPY public."user" (id, phone, email, ...) FROM stdin;
      const match = line.match(/\((.*?)\)/);
      if (match) {
        columnOrder = match[1].split(",").map((c) => c.trim());
      }
      output.write(line + "\n");
      continue;
    }

    // End of COPY block
    if (inCopyBlock && line === "\\.") {
      inCopyBlock = false;
      currentTable = "";
      columnOrder = [];
      output.write(line + "\n");
      continue;
    }

    // Sanitize data rows in COPY blocks
    if (inCopyBlock && currentTable === "user") {
      const sanitized = sanitizeUserRow(line, columnOrder);
      if (sanitized !== line) linesSanitized++;
      output.write(sanitized + "\n");
      continue;
    }

    // Pass through unchanged
    output.write(line + "\n");
  }

  // Wait for the write stream to finish flushing to disk before returning
  // This prevents race conditions where restoreDatabase reads an incomplete file
  await new Promise<void>((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
    output.end();
  });

  log(`Processed ${linesProcessed} lines, sanitized ${linesSanitized} rows`);
}

function sanitizeUserRow(row: string, columns: string[]): string {
  // COPY format uses tab-separated values
  const values = row.split("\t");

  if (values.length !== columns.length) {
    // Malformed row, pass through
    return row;
  }

  const phoneIndex = columns.indexOf("phone");
  const emailIndex = columns.indexOf("email");
  const idIndex = columns.indexOf("id");

  if (idIndex === -1) {
    return row; // No ID column, can't sanitize safely
  }

  const userId = values[idIndex];
  const phone = phoneIndex !== -1 ? values[phoneIndex] : null;

  // Check if this user is in the allowlist
  if (phone && ALLOWLISTED_PHONES.includes(phone.replace("+", ""))) {
    verbose(`Keeping real data for allowlisted user: ${userId}`);
    return row;
  }

  // Sanitize phone
  if (phoneIndex !== -1 && values[phoneIndex] !== "\\N") {
    values[phoneIndex] = TABLES_WITH_PII.user.phone(userId);
  }

  // Sanitize email
  if (emailIndex !== -1 && values[emailIndex] !== "\\N") {
    values[emailIndex] = TABLES_WITH_PII.user.email(userId);
  }

  return values.join("\t");
}

async function restoreDatabase(
  dbUrl: string,
  inputFile: string
): Promise<void> {
  verbose(`Restoring from ${inputFile}`);

  // Use psql to restore
  // Using execFileSync with args array to avoid shell metacharacter issues with passwords
  const args = [dbUrl, "-f", inputFile];

  try {
    execFileSync("psql", args, { stdio: isVerbose ? "inherit" : "pipe" });
  } catch (err) {
    throw new Error(`psql restore failed: ${err}`);
  }

  // Immediately verify tables exist using the same connection string
  // This helps debug if the issue is with the restore or with subsequent connections
  const tablesCheck = execFileSync(
    "psql",
    [dbUrl, "-t", "-c", "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'"],
    { encoding: "utf-8" }
  ).trim();
  verbose(`Restore verification: ${tablesCheck} tables in public schema`);

  verbose("Restore complete");
}

async function verifyRestoration(dbUrl: string): Promise<void> {
  verbose("Running verification queries...");

  try {
    // Debug: List all tables in the public schema to understand what was created
    const tables = execFileSync(
      "psql",
      [dbUrl, "-t", "-c", "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"],
      { encoding: "utf-8" }
    ).trim();
    verbose(`Tables in public schema: ${tables.split('\n').map(t => t.trim()).filter(Boolean).join(', ') || 'NONE'}`);

    // Check that tables exist and have data
    // Using execFileSync with args array to avoid shell metacharacter issues with passwords
    // Use explicit public schema prefix to avoid search_path issues with Supabase pooler
    // Note: Table is named 'user' (singular) not 'users'
    const result = execFileSync(
      "psql",
      [dbUrl, "-t", "-c", 'SELECT COUNT(*) FROM public."user"'],
      { encoding: "utf-8" }
    ).trim();

    const userCount = parseInt(result, 10);
    log(`Verification: ${userCount} users in staging database`);

    if (userCount === 0) {
      throw new Error("No users found in staging database after restore");
    }

    // Check that PII is sanitized (sample non-allowlisted user)
    // Match both formats: with and without '+' prefix
    // Use explicit public schema prefix to avoid search_path issues with Supabase pooler
    // Note: Table is named 'user' (singular) not 'users'
    const phoneConditions = ALLOWLISTED_PHONES.length > 0
      ? ALLOWLISTED_PHONES.flatMap((p) => [`'+${p}'`, `'${p}'`]).join(",")
      : "''";
    const sampleEmail = execFileSync(
      "psql",
      [dbUrl, "-t", "-c", `SELECT email FROM public."user" WHERE phone NOT IN (${phoneConditions}) LIMIT 1`],
      { encoding: "utf-8" }
    ).trim();

    if (sampleEmail && !sampleEmail.endsWith("@staging.togather.test")) {
      throw new Error(
        `PII sanitization may have failed. Sample email: ${sampleEmail}`
      );
    }

    log("Verification passed");
  } catch (err) {
    throw new Error(`Verification failed: ${err}`);
  }
}

// Run
main().catch((err) => {
  error(err.message);
  process.exit(1);
});
