# Togather Mobile App

A cross-platform mobile application built with React Native and Expo, providing a comprehensive platform for community management, group organization, messaging, and event coordination.

## Overview

The Togather mobile app enables users to:
- Connect with communities and join groups
- Manage group memberships, events, and RSVPs
- Send and receive real-time messages via chat
- Access leader tools for group management
- View community announcements and messages
- Manage profiles and settings

The app supports iOS, Android, and Web platforms using Expo Router for file-based routing.

## Tech Stack

- **Framework**: React Native with Expo (~54.0.23)
- **React**: 19.1.0
- **Routing**: Expo Router (~6.0.14) with file-based routing
- **State Management**: Zustand, React Query (@tanstack/react-query)
- **Real-time Communication**: Ably Chat (@ably/chat)
- **Forms**: React Hook Form with Zod validation
- **Language**: TypeScript
- **Package Manager**: pnpm 8.15.0

## Prerequisites

- Node.js (v20+ recommended)
- pnpm installed globally (`npm install -g pnpm`)
- Expo CLI (`npm install -g expo-cli` or use `npx`)
- iOS Simulator (for iOS development on macOS)
- Android Studio (for Android development)
- EAS CLI (for builds and deployments): `npm install -g eas-cli`

## Setup

1. **Install dependencies** (from monorepo root):
   ```bash
   pnpm install
   ```

2. **Navigate to mobile app**:
   ```bash
   cd apps/mobile
   ```

3. **Verify setup**:
   ```bash
   pnpm start
   ```

## Development

### Starting the Development Server

**Production backend (default)**:
```bash
# From monorepo root
pnpm dev:mobile

# Or from apps/mobile directory
pnpm dev
```

**Local backend**:
```bash
# From monorepo root
pnpm dev:mobile:local

# Or from apps/mobile directory
pnpm dev --local
```

**Full dev stack** (backend + mobile + types):
```bash
# From monorepo root
pnpm dev           # Production backend
pnpm dev --local   # Local backend (starts backend if not running)
```

### Platform-Specific Commands

```bash
# iOS
pnpm ios

# Android
pnpm android

# Web
pnpm web
```

### Environment Configuration

The app uses Convex for backend operations. Environment configuration is managed through:

- **Production** (default): Connects to production Convex deployment
- **Staging**: Connects to staging Convex deployment (determined by `APP_VARIANT`)

Run with `pnpm dev` to start development with the default configuration.

## Project Structure

```
apps/mobile/
├── app/                    # Expo Router file-based routes
│   ├── (auth)/            # Authentication routes (signin, signup, login, etc.)
│   ├── (user)/            # User-specific routes (profile, settings, leader-tools)
│   ├── (admin)/           # Admin routes (dashboard, groups, members, etc.)
│   ├── (tabs)/            # Tab navigation routes
│   ├── (landing)/         # Public landing pages
│   ├── groups/            # Group browsing and details
│   ├── inbox/             # Chat/messaging
│   └── home/              # Home screen
├── components/            # Reusable UI components
│   ├── guards/           # Route guards (AuthGuard, PrivateRoute, etc.)
│   ├── navigation/       # Navigation components
│   └── ui/               # UI primitives (Button, Input, Modal, etc.)
├── features/             # Feature modules
│   ├── auth/             # Authentication logic
│   ├── chat/             # Chat/messaging features
│   ├── groups/           # Group management
│   ├── home/             # Home screen features
│   ├── leader-tools/     # Leader-specific tools
│   ├── profile/          # User profile
│   └── settings/         # App settings
├── services/             # API and service integrations
│   ├── api/             # API client and endpoints
│   └── websocket.ts     # WebSocket connection
├── providers/            # React context providers
├── utils/               # Utility functions
├── types/               # TypeScript type definitions
├── config/              # Configuration files
└── scripts/             # Build and development scripts
```

### Path Aliases

The project uses path aliases configured in `tsconfig.json` and `babel.config.js`:

- `@features/*` → `./features/*`
- `@components/*` → `./components/*`
- `@services/*` → `./services/*`
- `@utils/*` → `./utils/*`
- `@types/*` → `./types/*`
- `@providers/*` → `./providers/*`
- `@hooks/*` → `./hooks/*`
- `@/*` → `./*`

## Testing

### Running Tests

```bash
pnpm test
```

The test suite uses Jest with React Native Testing Library. Tests are configured to:
- Use `jest-expo` preset
- Support React 19 compatibility (via custom patches)
- Include coverage for `app/`, `components/`, `services/`, and `providers/` directories

### Test Configuration

- Test files: `**/__tests__/**/*.(ts|tsx|js)` or `**/*.(test|spec).(ts|tsx|js)`
- Setup files: `jest.patch.js`, `jest.setup.js`
- Timeout: 5000ms

## Building and Deployment

### Generating API Types

**Note:** TypeScript types are generated from the Convex schema. Types are imported directly from the Convex package.

### iOS Distribution (TestFlight)

The iOS app is distributed via TestFlight. The build and submission process uses EAS (Expo Application Services).

**Creating a new iOS build:**
```bash
# Create a production build for iOS
eas build --platform ios --profile production

# Submit to App Store Connect (TestFlight)
eas submit --platform ios
```

**Build profiles** (configured in `eas.json`):
- `preview`: Internal distribution builds (ad-hoc)
- `production`: App Store builds with auto-incrementing versions

### EAS OTA Updates (Over-the-Air)

For JavaScript-only changes (no native code modifications), use EAS Update to push updates instantly without going through TestFlight:

```bash
# Push an OTA update to production
eas update --branch production --message "Description of changes"

# Push an OTA update to preview channel
eas update --branch preview --message "Description of changes"
```

**When to use OTA updates:**
- Bug fixes in JavaScript/TypeScript code
- UI changes
- New features that don't require native modules

**When a new binary build is required:**
- Adding/updating native dependencies
- Changing app.json/app.config.js settings that affect the native build
- Updating Expo SDK version
- Modifying native code (iOS/Android directories)

### Android Distribution

Android builds can be created with EAS but are not currently distributed through a store:

```bash
# Create an Android build
eas build --platform android --profile production
```

### Building for Web

```bash
pnpm build
```

This creates a static export in the `dist/` directory.

### EAS Commands Reference

| Command | Description |
|---------|-------------|
| `eas build --platform ios` | Create iOS build |
| `eas build --platform android` | Create Android build |
| `eas submit --platform ios` | Submit to App Store Connect |
| `eas update --branch production` | Push OTA update to production |
| `pnpm validate-eas` | Validate EAS configuration |
| `pnpm builds:list` | List recent builds |
| `pnpm builds:logs` | View build logs |

## Key Features

### Authentication
- Email/password authentication
- Google OAuth integration
- Password reset functionality
- Session management with secure storage

### Groups
- Browse and join groups
- Group details and member management
- RSVP for group events
- Leader tools for group administration

### Messaging
- Real-time chat via Ably
- Group and direct messaging
- Message history and unread indicators
- Image sharing

### Leader Tools
- Event creation and management
- Member management
- Attendance tracking
- Group settings

### Admin Features
- Dashboard with community overview
- Member management
- Group administration
- Event management
- Reports and analytics
- Community settings

## Route Structure

### Public Routes
- `/` - Initial routing/redirect
- `/home` - User home screen
- `/groups` - Browse groups
- `/groups/[group_id]` - Group details
- `/inbox` - Chat inbox
- `/inbox/[chat_id]` - Chat conversation

### Authentication Routes (`(auth)` group)
- `/signin` - Sign in
- `/signup` - Sign up
- `/login` - Login
- `/reset-password` - Password reset
- `/welcome` - Welcome screen

### User Routes (`(user)` group)
- `/profile` - User profile
- `/settings` - User settings
- `/edit-profile` - Edit profile
- `/leader-tools` - Leader tools index
- `/leader-tools/[group_id]` - Group-specific leader tools
- `/dinner-party-search` - Search dinner parties
- `/create-group` - Create new group

### Admin Routes (`(admin)` group)
- `/admin/dashboard` - Admin dashboard
- `/admin/groups` - Admin group management
- `/admin/members` - Member management
- `/admin/settings` - Admin settings
- `/admin/community-settings` - Community settings
- `/admin/events` - Event management
- `/admin/reports` - Reports and analytics
- `/admin/homefeed` - Home feed management
- `/admin/account-setup` - Account setup

### Tab Navigation (`(tabs)` group)
- Redirects to main routes (Home, Groups, Inbox, Profile)

## Troubleshooting

### Metro Bundler Issues
If Metro bundler has issues, try:
```bash
# Kill existing Expo processes
./scripts/kill-expo.sh

# Clear cache and restart
pnpm start --clear
```

### React 19 Compatibility
The project includes custom patches for React 19 compatibility with jest-expo. If you encounter test issues, ensure `run-tests.js` is being used (it's configured in `package.json`).

### Type Generation
Types are automatically generated from the Convex schema. If you see type errors:
1. Ensure Convex is running: `pnpm dev --convex`
2. Restart your IDE's TypeScript server

## Scripts Reference

- `pnpm start` - Start Expo development server
- `pnpm dev` - Start with dev wrapper (supports `--local_api` and `--local_db` flags)
- `pnpm ios` - Start iOS simulator
- `pnpm android` - Start Android emulator
- `pnpm web` - Start web version
- `pnpm test` - Run test suite
- `pnpm lint` - Run ESLint
- `pnpm build` - Build static web export
- `pnpm generate-types` - Generate TypeScript types from backend API

## Additional Resources

- [Expo Documentation](https://docs.expo.dev/)
- [Expo Router Documentation](https://docs.expo.dev/router/introduction/)
- [React Native Documentation](https://reactnative.dev/)
- [React Query Documentation](https://tanstack.com/query/latest)

