# Notification System Setup Guide

This guide explains how to set up and configure the notification system for production.

## Prerequisites

Before enabling notifications in production, you need:

1. **Expo Account** - For Expo Push Notifications
2. **Apple Developer Account** - For iOS APNs configuration
3. **Firebase Account** - For Android FCM configuration (optional but recommended)

## Backend Setup

### 1. Run Database Migrations

```bash
cd apps/backend
python manage.py makemigrations notifications
python manage.py migrate
```

### 2. Environment Variables

Add to your `.env` or deployment configuration:

```bash
# Enable notifications (set to 0 to disable mock mode)
DISABLE_NOTIFICATION=0

# Expo configuration (optional - for tracking receipts)
EXPO_TOKEN=your_expo_token
```

### 3. Verify Notification App is Installed

The notifications app should already be in `INSTALLED_APPS`:

```python
# config/settings/__init__.py
INSTALLED_APPS = [
    ...
    "src.database.models.notifications",
    ...
]
```

## Mobile App Setup

### 1. Install Dependencies

```bash
cd apps/mobile
npx expo install expo-notifications expo-device expo-constants
```

### 2. Configure app.json / app.config.js

Add notification configuration:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#ffffff",
          "sounds": ["./assets/notification-sound.wav"]
        }
      ]
    ],
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#4CAF50",
      "androidMode": "default",
      "androidCollapsedTitle": "#{unread_notifications} new notifications"
    },
    "android": {
      "useNextNotificationsApi": true
    }
  }
}
```

### 3. Set Project ID

Add your Expo project ID to environment:

```bash
# .env
EXPO_PUBLIC_PROJECT_ID=your-expo-project-id
```

Get your project ID from: https://expo.dev/accounts/[username]/projects

## iOS Configuration (APNs)

### 1. Generate APNs Key

1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/authkeys/list)
2. Create a new key with "Apple Push Notifications service (APNs)" enabled
3. Download the `.p8` key file
4. Note your Key ID and Team ID

### 2. Upload to Expo

```bash
# Using EAS CLI
eas credentials

# Or manually at expo.dev project settings
```

### 3. Configure in Expo Dashboard

1. Go to your project on expo.dev
2. Navigate to Credentials → iOS
3. Add your APNs key

## Android Configuration (FCM)

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or use existing
3. Add an Android app with your package name

### 2. Download Configuration

Download `google-services.json` and place in `apps/mobile/`

### 3. Upload Server Key to Expo

1. In Firebase Console, go to Project Settings → Cloud Messaging
2. Copy the Server Key
3. Upload to Expo via dashboard or CLI

## Testing

### 1. Mock Mode (Development)

By default, notifications run in mock mode (`DISABLE_NOTIFICATION=1`).
In this mode, notifications are logged but not sent.

### 2. Test with Expo Go

For development testing:
1. Use a physical device (not simulator)
2. Build a development client: `npx expo run:ios` or `npx expo run:android`
3. Expo Go has limitations with push notifications

### 3. Send Test Notification

Use the Expo Push Notifications tool:
https://expo.dev/notifications

Or via API:

```bash
curl -X POST https://exp.host/--/api/v2/push/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "ExponentPushToken[xxxxxx]",
    "title": "Test Notification",
    "body": "This is a test"
  }'
```

## Production Checklist

- [ ] Database migrations applied
- [ ] `DISABLE_NOTIFICATION=0` in production
- [ ] Expo project ID configured
- [ ] APNs key uploaded for iOS
- [ ] FCM server key uploaded for Android
- [ ] Notification icons added to assets
- [ ] EAS build includes notification configuration
- [ ] Test notifications on both iOS and Android devices

## Troubleshooting

### Push Token Not Registering

1. Ensure using physical device (not simulator)
2. Check notification permissions in device settings
3. Verify Expo project ID is correct
4. Check console logs for errors

### Notifications Not Received

1. Verify `DISABLE_NOTIFICATION=0` on backend
2. Check token is registered in database: `SELECT * FROM push_token WHERE user_id = X`
3. Check Expo Push receipt for errors
4. Verify APNs/FCM configuration

### iOS Notifications Not Working in Production

1. Verify APNs key is valid and not expired
2. Check bundle ID matches
3. Ensure using production APNs environment (not sandbox)

### Android Notifications Not Working

1. Verify google-services.json is included in build
2. Check FCM server key is correct
3. Verify package name matches Firebase configuration

## Monitoring

### Check Notification Status

```sql
-- Failed notifications in last 24 hours
SELECT * FROM notification
WHERE status = 'failed'
AND created_at > NOW() - INTERVAL '24 hours';

-- Invalid tokens
SELECT * FROM push_token
WHERE is_active = true
AND updated_at < NOW() - INTERVAL '30 days';
```

### Cleanup Invalid Tokens

Tokens that fail should be deactivated. The system handles this automatically
when Expo returns `DeviceNotRegistered` error, but you can also run cleanup:

```python
# In Django shell
from src.business_logic.notifications.repository import notification_repository
# Cleanup expired mutes
notification_repository.cleanup_expired_mutes()
```
