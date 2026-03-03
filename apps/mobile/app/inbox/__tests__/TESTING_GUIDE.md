# React Native (Expo) Testing Guide

This guide documents the findings, pitfalls, and best practices discovered while writing tests for the React Native mobile app, specifically for the chat functionality.

## Table of Contents

1. [Jest Configuration](#jest-configuration)
2. [React Query Testing](#react-query-testing)
3. [Async State and Timing Issues](#async-state-and-timing-issues)
4. [Mocking Strategies](#mocking-strategies)
5. [Common Pitfalls](#common-pitfalls)
6. [Best Practices](#best-practices)
7. [Test Performance](#test-performance)

## Jest Configuration

### Key Configuration Options

```json
{
  "jest": {
    "preset": "jest-expo",
    "setupFilesAfterEnv": ["<rootDir>/jest.setup.js"],
    "testTimeout": 5000,
    "forceExit": true, // CRITICAL: Prevents Jest from hanging on open handles
    "transformIgnorePatterns": [
      "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@expo/vector-icons/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@tanstack/react-query|date-fns))"
    ]
  }
}
```

### Critical Configuration Details

#### `forceExit: true`

**Why it's needed:**

- React Native components often use `setTimeout` for UI animations (e.g., scroll animations)
- These timers create "open handles" that prevent Jest from exiting
- Without `forceExit`, Jest hangs indefinitely waiting for timers to complete
- **Pitfall**: Tests complete quickly but Jest never exits, causing CI/CD pipelines to hang

**Example:**

```typescript
// Component code that causes open handles
setTimeout(() => {
  flatListRef.current?.scrollToEnd({ animated: true });
}, 100);
```

#### `transformIgnorePatterns`

**Why it's needed:**

- React Native, Expo, and React Query use ESM (ECMAScript Modules)
- Jest needs to transform these modules with Babel
- Without proper patterns, you'll get: `SyntaxError: Cannot use import statement outside a module`
- **Pitfall**: Tests fail with ESM import errors for common libraries

**Solution:**

- Include all React Native, Expo, and React Query related packages
- Use pnpm-specific patterns: `node_modules/(?!(?:.pnpm/)?...)`

#### `testTimeout`

**Why it's needed:**

- React Query mutations can take time to resolve in tests
- Default timeout (5000ms) may be too short for complex async operations
- **Pitfall**: Tests timeout before async operations complete

## React Query Testing

### QueryClient Configuration for Tests

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: 0, // No garbage collection delay
      staleTime: 0, // Data is immediately stale
      cacheTime: 0, // No cache retention
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: false,
    },
  },
});
```

### Why These Settings Matter

1. **`retry: false`** - Prevents tests from waiting for retry attempts
2. **`gcTime: 0, staleTime: 0, cacheTime: 0`** - Ensures cache doesn't persist between tests
3. **No refetch options** - Prevents unnecessary API calls during tests

### Pre-populating Query Cache

```typescript
// Pre-populate cache to avoid waiting for API calls
beforeEach(() => {
  queryClient.setQueryData(["chatMessages", "1"], { data: [], page_info: {} });
});
```

**Why:** Avoids waiting for mocked API calls, making tests faster and more predictable.

### Testing Mutations

#### ❌ Pitfall: Checking `isPending` Synchronously

```typescript
// WRONG - isPending doesn't update synchronously
fireEvent.press(sendButton);
expect(sendButton.props.disabled).toBe(true); // Fails - isPending hasn't updated yet
```

#### ✅ Solution: Wait for Mutation State Updates

```typescript
// CORRECT - Wait for mutation to start
fireEvent.press(sendButton);

// Wait for API call to be made
await waitFor(
  () => {
    expect(api.sendMessage).toHaveBeenCalled();
  },
  { timeout: 1000 }
);

// Wait for React Query to update isPending state
await waitFor(
  () => {
    const button = screen.getByTestId("send-button");
    expect(
      button.props.disabled === true || api.sendMessage
    ).toHaveBeenCalled();
  },
  { timeout: 1000 }
);
```

**Key Insight:** React Query's `isPending` state updates asynchronously. Always use `waitFor` to check mutation state.

## Async State and Timing Issues

### Problem: React Query State Updates Are Asynchronous

React Query updates state asynchronously, even after mutations are triggered. This means:

1. **Component doesn't re-render immediately** after mutation starts
2. **`isPending` state may not be set** when you check it
3. **Props may not reflect the latest state** synchronously

### Solution: Use `waitFor` with Fallbacks

```typescript
// Wait for either the disabled prop OR verify the mutation was called
await waitFor(
  () => {
    const button = screen.getByTestId("send-button");
    // Check disabled prop, or verify mutation was triggered as fallback
    expect(
      button.props.disabled === true || api.sendMessage
    ).toHaveBeenCalled();
  },
  { timeout: 1000 }
);
```

### Problem: `setTimeout` in Components

Components often use `setTimeout` for animations and UI updates:

```typescript
// Component code
setTimeout(() => {
  flatListRef.current?.scrollToEnd({ animated: true });
}, 100);
```

**Impact:** These timers keep Jest alive even after tests complete.

**Solution:** Use `forceExit: true` in Jest config (see above).

## Mocking Strategies

### Mock Order Matters

```typescript
// 1. Define mock function FIRST
const mockUseRouter = jest.fn(() => ({
  push: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  replace: jest.fn(),
}));

// 2. Mock the module SECOND
jest.mock("expo-router", () => ({
  useRouter: () => mockUseRouter(),
  useLocalSearchParams: () => ({ chat_id: "1" }),
}));

// 3. Import components LAST (after mocks are set up)
import ChatDetailScreen from "../[chat_id]";
```

**Why:** Jest hoists mocks, but the order matters for function mocks that need to be overridden.

### Mocking Services

```typescript
jest.mock("../../../services/api", () => ({
  api: {
    getAllRooms: jest.fn(),
    getChatMessages: jest.fn(),
    sendMessage: jest.fn(),
    deleteMessage: jest.fn(),
  },
}));

// In tests, require to get fresh mock instance
const { api } = require("../../../services/api");
api.sendMessage.mockResolvedValue(mockMessage);
```

**Key Points:**

- Use `require()` in tests to get fresh mock instances
- Set up default mock returns in `beforeEach`
- Reset mocks with `jest.clearAllMocks()` in `beforeEach`

### Mocking Promises for Async Testing

```typescript
let resolveSendMessage: (value: any) => void;
const sendMessagePromise = new Promise((resolve) => {
  resolveSendMessage = resolve;
});

api.sendMessage.mockReturnValue(sendMessagePromise);

// Later in test
await act(async () => {
  resolveSendMessage!(mockMessage);
  await sendMessagePromise;
});
```

**Why:** Allows you to control when async operations complete, making tests deterministic.

## Common Pitfalls

### 1. ❌ Using `findBy` When You Don't Need to Wait

```typescript
// WRONG - Unnecessary waiting
const textInput = await screen.findByPlaceholderText(
  "Type a message...",
  {},
  { timeout: 1000 }
);
```

```typescript
// CORRECT - Use getBy when element should exist immediately
const textInput = screen.getByPlaceholderText("Type a message...");
```

**Rule of Thumb:**

- Use `getBy` when element should exist immediately (pre-populated cache)
- Use `findBy` only when waiting for async content to appear
- Use `queryBy` when element might not exist

### 2. ❌ Not Pre-populating Query Cache

```typescript
// WRONG - Tests wait for API calls
renderComponent();
const element = await screen.findByText("Content"); // Waits for API
```

```typescript
// CORRECT - Pre-populate cache
beforeEach(() => {
  queryClient.setQueryData(["chatMessages", "1"], {
    data: mockMessages,
    page_info: {},
  });
});

renderComponent();
const element = screen.getByText("Content"); // Immediate
```

### 3. ❌ Checking Mutation State Synchronously

```typescript
// WRONG - isPending not updated yet
fireEvent.press(button);
expect(button.props.disabled).toBe(true); // Fails
```

```typescript
// CORRECT - Wait for state update
fireEvent.press(button);
await waitFor(
  () => {
    expect(button.props.disabled).toBe(true);
  },
  { timeout: 1000 }
);
```

### 4. ❌ Not Cleaning Up Between Tests

```typescript
// WRONG - Cache persists between tests
beforeEach(() => {
  queryClient = new QueryClient();
});
```

```typescript
// CORRECT - Clear cache between tests
beforeEach(() => {
  queryClient = new QueryClient({
    /* config */
  });
});

afterEach(() => {
  queryClient.clear();
});
```

### 5. ❌ Not Using `act` for State Updates

```typescript
// WRONG - State updates not wrapped
fireEvent.changeText(input, "text");
```

```typescript
// CORRECT - Wrap state updates in act
act(() => {
  fireEvent.changeText(input, "text");
});
```

### 6. ❌ Missing Timeout Configuration

```typescript
// WRONG - May timeout on slow operations
await waitFor(() => {
  expect(condition).toBe(true);
});
```

```typescript
// CORRECT - Explicit timeout
await waitFor(
  () => {
    expect(condition).toBe(true);
  },
  { timeout: 1000 }
);
```

## Best Practices

### 1. ✅ Use `getBy` When Possible

Pre-populate query cache and use `getBy` for immediate access:

```typescript
// Pre-populate in beforeEach
queryClient.setQueryData(["key"], mockData);

// Use getBy in tests
const element = screen.getByText("Content");
```

### 2. ✅ Keep Tests Fast

- Pre-populate cache instead of waiting for API calls
- Use `getBy` instead of `findBy` when possible
- Mock all external dependencies
- Keep test data minimal

### 3. ✅ Test User Behavior, Not Implementation

```typescript
// GOOD - Tests user interaction
fireEvent.press(sendButton);
await waitFor(() => {
  expect(api.sendMessage).toHaveBeenCalled();
});
```

```typescript
// BAD - Tests implementation details
expect(sendMessageMutation.isPending).toBe(true);
```

### 4. ✅ Use Descriptive Test Names

```typescript
// GOOD
it("should disable send button while sending message", () => {});

// BAD
it("should work", () => {});
```

### 5. ✅ Isolate Tests

Each test should be independent:

- Clear cache between tests
- Reset mocks between tests
- Don't rely on execution order

### 6. ✅ Handle Async Operations Properly

```typescript
// Always use act for state updates
act(() => {
  fireEvent.press(button);
});

// Always use waitFor for async assertions
await waitFor(
  () => {
    expect(condition).toBe(true);
  },
  { timeout: 1000 }
);
```

### 7. ✅ Mock External Dependencies

Mock all services, APIs, and external libraries:

- API calls
- WebSocket connections
- Navigation
- Storage
- Platform-specific APIs

## Test Performance

### Optimizations That Worked

1. **Pre-populating Cache**: Reduced test time from ~5s to ~2s
2. **Using `getBy` Instead of `findBy`**: Eliminated unnecessary waits
3. **`forceExit: true`**: Prevents hanging (critical for CI/CD)
4. **QueryClient Config**: Disabled retries and refetching

### Performance Targets

- **Individual tests**: < 100ms each
- **Full suite (13 tests)**: < 3 seconds
- **No hanging**: Tests should exit immediately

### Measuring Performance

```bash
# Run tests with timing
pnpm test --verbose

# Check for open handles (if tests hang)
pnpm jest --detectOpenHandles
```

## Summary Checklist

When writing React Native tests:

- [ ] Configure Jest with `forceExit: true`
- [ ] Set up proper `transformIgnorePatterns` for ESM modules
- [ ] Configure QueryClient with test-friendly defaults
- [ ] Pre-populate query cache in `beforeEach`
- [ ] Clear cache in `afterEach`
- [ ] Use `getBy` when element should exist immediately
- [ ] Use `waitFor` for async state checks
- [ ] Wrap state updates in `act()`
- [ ] Mock all external dependencies
- [ ] Use descriptive test names
- [ ] Keep tests independent and isolated
- [ ] Test user behavior, not implementation details

## Common Error Messages and Solutions

### "Cannot use import statement outside a module"

**Solution:** Add package to `transformIgnorePatterns`

### "Jest did not exit one second after the test run"

**Solution:** Add `forceExit: true` to Jest config

### "TypeError: Cannot read property 'X' of undefined"

**Solution:** Ensure mocks are set up before importing components

### "Test timeout exceeded"

**Solution:** Increase `testTimeout` or use `waitFor` with proper timeouts

### "Warning: An update was not wrapped in act(...)"

**Solution:** Wrap state updates in `act()` from `@testing-library/react-native`

---

**Last Updated:** Based on testing experience with React Native (Expo) chat functionality, January 2025
