#!/usr/bin/env node
/**
 * Custom server wrapper for expo serve that handles bot detection
 *
 * This script:
 * 1. Detects bot user agents
 * 2. For bots on /e/* or /g/* routes: fetches OG data from Convex and returns OG HTML
 * 3. For regular users: proxies to expo serve
 *
 * Usage: node scripts/serve-with-og.js
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const PORT = 3000;
const EXPO_PORT = 3001;
const BRAND_NAME = 'Togather';

// Bot user agents that need link previews
const BOT_USER_AGENTS = [
  'facebookexternalhit', 'Facebot', 'Twitterbot', 'LinkedInBot',
  'WhatsApp', 'Slackbot', 'TelegramBot', 'Discordbot', 'Pinterest',
  'Googlebot', 'bingbot', 'Applebot', 'bot', 'crawl', 'spider', 'preview'
];

function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some(bot => ua.includes(bot.toLowerCase()));
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function generateEventOgHtml(event, shortId, baseUrl) {
  const eventTitle = escapeHtml(event.title || 'Event');
  const title = `RSVP to ${eventTitle}`;
  const groupName = escapeHtml(event.groupName || '');
  const communityName = escapeHtml(event.communityName || BRAND_NAME);
  const dateStr = formatDate(event.scheduledAt);
  const location = escapeHtml(event.locationOverride || '');

  let richDescription = '';
  if (dateStr) richDescription += dateStr;
  if (location) richDescription += richDescription ? ` • ${location}` : location;
  if (event.note) richDescription += richDescription ? `\n\n${escapeHtml(event.note)}` : escapeHtml(event.note);
  if (!richDescription) richDescription = `Join ${groupName} for this event`;

  const imageUrl = event.coverImageFallback || event.coverImage ||
                   event.groupImageFallback || event.groupImage || event.communityLogo || '';
  const eventUrl = `${baseUrl}/e/${shortId}`;

  return generateOgHtml(title, communityName, richDescription, imageUrl, eventUrl, eventTitle, groupName, dateStr, location);
}

function generateGroupOgHtml(group, shortId, baseUrl) {
  const groupName = escapeHtml(group.name || 'Group');
  const title = `Join ${groupName}`;
  const communityName = escapeHtml(group.communityName || BRAND_NAME);
  const location = group.city && group.state ? `${escapeHtml(group.city)}, ${escapeHtml(group.state)}` : '';
  const memberCount = group.memberCount || 0;

  let richDescription = '';
  if (group.groupTypeName) richDescription = escapeHtml(group.groupTypeName);
  if (location) richDescription += richDescription ? ` • ${location}` : location;
  if (memberCount > 0) richDescription += richDescription ? ` • ${memberCount} members` : `${memberCount} members`;
  if (group.description) richDescription += richDescription ? `\n\n${escapeHtml(group.description)}` : escapeHtml(group.description);
  if (!richDescription) richDescription = `Join ${groupName} on ${communityName}`;

  const imageUrl = group.preview || group.communityLogo || '';
  const groupUrl = `${baseUrl}/g/${shortId}`;

  return generateOgHtml(title, communityName, richDescription, imageUrl, groupUrl, groupName, communityName,
                        location, memberCount > 0 ? `${memberCount} members` : '');
}

function generateOgHtml(title, siteName, description, imageUrl, url, mainTitle, subtitle, line1, line2) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | ${siteName}</title>
  <meta name="title" content="${title} | ${siteName}">
  <meta name="description" content="${description.substring(0, 200)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${title} | ${siteName}">
  <meta property="og:description" content="${description.substring(0, 200)}">
  <meta property="og:site_name" content="${siteName}">
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ''}
  ${imageUrl ? `<meta property="og:image:width" content="1200">` : ''}
  ${imageUrl ? `<meta property="og:image:height" content="630">` : ''}
  <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:url" content="${url}">
  <meta name="twitter:title" content="${title} | ${siteName}">
  <meta name="twitter:description" content="${description.substring(0, 200)}">
  ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}">` : ''}
</head>
<body>
  <h1>${mainTitle}</h1>
  <p>${subtitle}</p>
  ${line1 ? `<p>${line1}</p>` : ''}
  ${line2 ? `<p>${line2}</p>` : ''}
</body>
</html>`;
}

function generateErrorHtml(type, shortId, baseUrl) {
  const url = `${baseUrl}/${type}/${shortId}`;
  const typeLabel = type === 'e' ? 'Event' : 'Group';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${typeLabel} | ${BRAND_NAME}</title>
  <meta property="og:title" content="${typeLabel} | ${BRAND_NAME}">
  <meta property="og:description" content="View this ${typeLabel.toLowerCase()} on ${BRAND_NAME}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
</head>
<body><p>${typeLabel}</p></body>
</html>`;
}

async function fetchData(endpoint, shortId) {
  const convexCloudUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!convexCloudUrl) return null;

  // Convex HTTP endpoints use .site domain, not .cloud
  const convexSiteUrl = convexCloudUrl.replace('.convex.cloud', '.convex.site');

  return new Promise((resolve) => {
    const url = `${convexSiteUrl}/link-preview/${endpoint}?shortId=${encodeURIComponent(shortId)}`;
    const client = url.startsWith('https') ? https : http;

    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.error ? null : json);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function proxyRequest(req, res) {
  const options = {
    hostname: 'localhost',
    port: EXPO_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const userAgent = req.headers['user-agent'];
  const baseUrl = `http://localhost:${PORT}`;

  // Check if this is a bot requesting /e/* or /g/*
  const eventMatch = url.pathname.match(/^\/e\/([^\/]+)$/);
  const groupMatch = url.pathname.match(/^\/g\/([^\/]+)$/);

  if (isBot(userAgent) && (eventMatch || groupMatch)) {
    const shortId = eventMatch ? eventMatch[1] : groupMatch[1];
    const type = eventMatch ? 'e' : 'g';
    const endpoint = eventMatch ? 'event' : 'group';

    console.log(`[Bot] ${userAgent?.substring(0, 30)}... requesting /${type}/${shortId}`);

    const data = await fetchData(endpoint, shortId);
    let html;

    if (data) {
      html = eventMatch
        ? generateEventOgHtml(data, shortId, baseUrl)
        : generateGroupOgHtml(data, shortId, baseUrl);
    } else {
      html = generateErrorHtml(type, shortId, baseUrl);
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Proxy to expo serve for all other requests
  proxyRequest(req, res);
}

// Start expo serve on a different port
console.log(`Starting expo serve on port ${EXPO_PORT}...`);
const expoProcess = spawn('npx', ['expo', 'serve', '--port', String(EXPO_PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
});

expoProcess.stdout.on('data', (data) => {
  const msg = data.toString();
  if (msg.includes('Server running')) {
    console.log(`Expo serve ready on port ${EXPO_PORT}`);
  }
});

expoProcess.stderr.on('data', (data) => {
  console.error(`[expo] ${data}`);
});

// Wait for expo serve to start, then start our server
setTimeout(() => {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`\n🚀 Server with OG support running at http://localhost:${PORT}`);
    console.log(`   - Bots on /e/* and /g/* get OG meta tags`);
    console.log(`   - All other requests proxied to expo serve\n`);
  });
}, 3000);

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  expoProcess.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  expoProcess.kill();
  process.exit();
});
