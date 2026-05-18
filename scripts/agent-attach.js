#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Polyfill FormData for Node.js 16/18
// Using curl instead

async function main() {
  const args = process.argv.slice(2);
  let issueIdentifier = process.env.PAPERCLIP_TASK_ID;
  let filePath = '';
  let comment = '';

  for (const arg of args) {
    if (arg.startsWith('--issue=')) issueIdentifier = arg.split('=')[1];
    if (arg.startsWith('--file=')) filePath = arg.split('=')[1];
    if (arg.startsWith('--comment=')) comment = arg.split('=')[1];
  }

  if (!issueIdentifier) {
    console.error('Error: Must provide --issue=... or have PAPERCLIP_TASK_ID set');
    process.exit(1);
  }
  if (!filePath) {
    console.error('Error: Must provide --file=...');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    process.exit(1);
  }

  const apiKey = process.env.PAPERCLIP_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  const apiUrl = process.env.PAPERCLIP_API_URL || 'http://127.0.0.1:3100';
  const runId = process.env.PAPERCLIP_RUN_ID;

  if (!apiKey || !companyId) {
    console.error('Error: Missing PAPERCLIP_API_KEY or PAPERCLIP_COMPANY_ID environment variables');
    process.exit(1);
  }

  // 1. Resolve Issue ID
  let issueId = issueIdentifier;
  // If it's not a UUID, search for it
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issueId)) {
    console.log(`Resolving issue ${issueIdentifier}...`);
    const searchRes = await fetch(`${apiUrl}/api/companies/${companyId}/issues?q=${issueIdentifier}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!searchRes.ok) {
      console.error(`Failed to search issue: ${await searchRes.text()}`);
      process.exit(1);
    }
    const issues = await searchRes.json();
    const match = issues.find(i => i.identifier === issueIdentifier || i.id === issueIdentifier);
    if (!match) {
      console.error(`Could not find issue with identifier ${issueIdentifier}`);
      process.exit(1);
    }
    issueId = match.id;
  }

  // 2. Upload Attachment
  console.log(`Uploading ${filePath} to issue ${issueId}...`);
  
  // Use curl to bypass missing FormData/form-data module issues in node < 18
  const args = [
    '-s', '-X', 'POST',
    '-H', `Authorization: Bearer ${apiKey}`,
  ];
  if (runId) {
    args.push('-H', `X-Paperclip-Run-Id: ${runId}`);
  }
  args.push(
    '-F', `file=@${filePath}`,
    `${apiUrl}/api/companies/${companyId}/issues/${issueId}/attachments`
  );
    
  let uploadOut;
  try {
    uploadOut = require('child_process').execFileSync('curl', args, { encoding: 'utf8' });
  } catch (e) {
    console.error(`Failed to upload attachment via curl`);
    process.exit(1);
  }

  let attachment;
  try {
    attachment = JSON.parse(uploadOut);
  } catch (e) {
    console.error(\`Failed to parse upload response: \${uploadOut}\`);
    process.exit(1);
  }
  
  if (attachment.error) {
    console.error(\`Failed to upload attachment: \${attachment.error}\`);
    process.exit(1);
  }
  console.log(\`Upload successful. Attachment ID: \${attachment.id}\`);

  // 3. Post Comment if provided
  if (comment) {
    console.log('Posting comment...');
    // Create markdown image link depending on content type
    let markdownLink = `[Attachment](/api/attachments/${attachment.id}/content)`;
    if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.gif')) {
       markdownLink = `![${path.basename(filePath)}](/api/attachments/${attachment.id}/content)`;
    }

    const fullComment = `${comment}\n\n${markdownLink}`;

    const commentRes = await fetch(`${apiUrl}/api/issues/${issueId}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Paperclip-Run-Id': runId || '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: fullComment })
    });

    if (!commentRes.ok) {
      console.error(`Failed to post comment: ${await commentRes.text()}`);
      process.exit(1);
    }
    console.log('Comment posted successfully.');
  }
}

main().catch(err => {
  console.error('Attachment failed:', err);
  process.exit(1);
});