# Testing Expo App on Your Phone

This guide walks you through testing your Expo app on a physical device.

## Prerequisites

1. **Expo Go app** installed on your phone
   - iOS: [Download from App Store](https://apps.apple.com/app/expo-go/id982107779)
   - Android: [Download from Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. **Same WiFi network**: Your phone and computer must be on the same WiFi network

3. **Backend running**: Make sure your backend is running and accessible (for local testing)

## Step-by-Step Instructions

### 1. Find Your Computer's Local IP Address

Your local IP can be found using the commands below. Replace `<your-local-ip>` throughout this guide with your actual IP address.

If your IP changes, you can find it again:
```bash
# macOS/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Or use this simpler command:
ipconfig getifaddr en0  # macOS, replace en0 with your interface if needed
```

**Windows users:**
```bash
ipconfig
# Look for "IPv4 Address" under your active network adapter
```

### 2. Update Configuration (Already Done)

The app is already configured to use your IP address:
- ✅ `apps/mobile/app.json` → `apiBaseUrl: "http://<your-local-ip>:3000"`
- ✅ Backend server configured to listen on `0.0.0.0:3000` (accessible from network)

**If your IP changes:**
1. Update `apps/mobile/app.json` with your new IP address
2. Restart the Expo dev server

### 3. Start the Development Servers

In your project root, run:

```bash
# Option 1: Start everything (backend + mobile)
pnpm dev

# Option 2: Start them separately
# Terminal 1: Backend
pnpm dev:backend

# Terminal 2: Mobile app
pnpm dev:mobile
```

### 4. Connect Your Phone

When Expo starts, you'll see a QR code in the terminal. Here's how to connect:

#### Option A: Scan QR Code (Easiest)

1. **iOS**: Open the Camera app and point it at the QR code
   - A notification will appear
   - Tap it to open in Expo Go

2. **Android**: Open the Expo Go app
   - Tap "Scan QR Code"
   - Scan the code from your terminal

#### Option B: Manual Connection

1. In the Expo terminal, you'll see a connection URL like:
   ```
   exp://<your-local-ip>:8081
   ```

2. In Expo Go app:
   - Tap "Enter URL manually"
   - Type the connection URL
   - Tap "Connect"

### 5. Troubleshooting

#### Phone Can't Connect to Dev Server

**Check WiFi Connection:**
- Ensure both devices are on the same WiFi network
- Try disconnecting and reconnecting to WiFi on both devices

**Check Firewall:**
- macOS: System Settings → Network → Firewall (may need to allow Node.js)
- Windows: Windows Defender Firewall (may need to allow Node.js)

**Try Tunnel Mode:**
If same-network connection doesn't work, you can use Expo's tunnel:
```bash
cd apps/mobile
expo start --tunnel
```
Note: Tunnel mode is slower but works across different networks.

#### Backend Connection Issues

**Test Backend Accessibility:**
From your phone's browser, try accessing:
```
http://<your-local-ip>:3000/trpc
```

If this doesn't work:
1. Check backend is running: `curl http://localhost:3000/trpc`
2. Verify backend is bound to `0.0.0.0:3000`
3. Check your computer's firewall settings

#### App Shows Network Errors

**Check API URL:**
- Verify `apps/mobile/app.json` has the correct IP address
- Restart Expo after changing the IP

**Check Backend Logs:**
- Look for CORS errors in backend terminal
- Backend should have `CORS_ORIGIN_ALLOW_ALL = True` (already configured)

### 6. Quick Reference

```bash
# Find your IP (macOS)
ipconfig getifaddr en0

# Start development
pnpm dev

# Start mobile only
pnpm dev:mobile

# Start with tunnel (if same network doesn't work)
cd apps/mobile && expo start --tunnel

# Clear Expo cache if needed
cd apps/mobile && expo start --clear
```

## What to Expect

1. **First Load**: The app will take a moment to load on your phone
2. **Hot Reloading**: Changes to your code will automatically reload on your phone
3. **Debugging**: You can shake your phone to open the Expo developer menu

## Switching Between Simulator and Phone

- **Simulator/Emulator**: Use `localhost:3000` in `app.json`
- **Physical Device**: Use your local IP (e.g., `<your-local-ip>:3000`)

**Tip**: You can create a script to switch between configurations, or use environment variables to make this easier.

## Next Steps

Once you're testing on your phone:
- Test all major features
- Check touch interactions
- Verify network requests work correctly
- Test on both iOS and Android if possible

## Need Help?

- [Expo Documentation](https://docs.expo.dev/)
- [Expo Go Troubleshooting](https://docs.expo.dev/get-started/installation/)
- Check backend logs in terminal for API errors
- Check Expo logs in terminal for app errors

