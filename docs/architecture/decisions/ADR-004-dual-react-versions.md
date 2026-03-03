# ADR-004: Dual React Versions

## Status

**Status**: Accepted  
**Date**: 2024  
**Deciders**: Development Team

## Context

The Togather monorepo contains two applications:

- **Web App** (`apps/web/`) - Next.js admin dashboard
- **Mobile App** (`apps/mobile/`) - Expo React Native app

These applications have different React version requirements:

1. **Web App** uses React 18.3.1 due to:
   - Next.js 14.2.33 compatibility (Next.js 14 doesn't support React 19)
   - Material-UI v4 compatibility (Material-UI v4 has limited React 19 support)
   - Peer dependency constraints

2. **Mobile App** uses React 19.1.0 due to:
   - Expo SDK 54 default React version
   - React Native 0.81.5 compatibility
   - No blocking dependencies

## Decision

We will maintain **two different React versions** in the monorepo:

- Web app: React 18.3.1
- Mobile app: React 19.1.0

This is a temporary situation until we can upgrade the web app to React 19.

## Consequences

### Positive

1. **Mobile App Benefits** - Mobile app can use React 19 features and improvements
2. **No Blocking** - Doesn't block mobile app development
3. **Gradual Migration** - Allows gradual migration path for web app

### Negative

1. **Shared Code Complexity** - `@togather/shared` package must be compatible with both React 18 and React 19
2. **Developer Confusion** - Developers must be aware of which React version they're working with
3. **Type Definitions** - May need version-specific type definitions
4. **Maintenance Overhead** - Two sets of React-related dependencies to maintain
5. **Potential Bugs** - Version-specific bugs may arise

### Risks

1. **Shared Package Issues** - Shared code may have compatibility issues
2. **Dependency Conflicts** - Potential dependency resolution conflicts
3. **Testing Complexity** - Need to test shared code with both versions

## Migration Path

To resolve this technical debt, we need to:

1. **Upgrade Next.js** - Upgrade to Next.js 15+ (supports React 19)
2. **Migrate Material-UI** - Migrate from Material-UI v4 to MUI v5/v6 (supports React 19)
3. **Upgrade React** - Upgrade React to 19.1.0 in web app
4. **Unify Versions** - Ensure both apps use React 19.1.0

See [React Versions Technical Debt](../../debt/react-versions.md) for detailed migration plan.

## Alternatives Considered

### Alternative 1: Downgrade Mobile to React 18

**Rejected because:**

- Expo SDK 54 uses React 19 by default
- Would require significant workarounds
- Lose React 19 benefits in mobile app
- Not a long-term solution

### Alternative 2: Force React 19 Everywhere

**Rejected because:**

- Next.js 14 doesn't support React 19
- Material-UI v4 doesn't fully support React 19
- Would require simultaneous upgrades of multiple major dependencies
- High risk of breaking changes

### Alternative 3: Wait for All Dependencies to Support React 19

**Rejected because:**

- Would block mobile app from using React 19
- Unclear timeline for dependency updates
- Not proactive

## Implementation Notes

### Current Configuration

**Web App** (`apps/web/package.json`):

```json
{
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "next": "^14.2.0"
  }
}
```

**Mobile App** (`apps/mobile/package.json`):

```json
{
  "dependencies": {
    "react": "19.1.0",
    "react-dom": "19.1.0"
  }
}
```

### Shared Package Considerations

The `@togather/shared` package must:

- Use React types compatible with both versions
- Avoid React version-specific APIs
- Test with both React versions

### Developer Guidelines

Developers should:

- Be aware of which React version they're working with
- Check React version when encountering issues
- Document React version requirements for new features
- Avoid React version-specific code in shared package

## Related Documentation

- [React Versions Technical Debt](../../debt/react-versions.md) - Detailed technical debt documentation
- [Dependencies Technical Debt](../../debt/dependencies.md) - Dependency upgrade blockers
- [Next.js Upgrade Guide](https://nextjs.org/docs/app/building-your-application/upgrading/version-15)
- [MUI Migration Guide](https://mui.com/material-ui/migration/migration-v4/)

## Notes

- This is a **temporary situation** until web app can be upgraded
- Migration should be prioritized but done carefully
- Monitor for compatibility issues in shared code
- Update this ADR when React versions are unified
