# Error Handling Test Guide

Quick reference for running and understanding the error handling tests.

## Test Files Overview

### 1. Backend Tests
**Location**: `/apps/convex/__tests__/error-handling-group-creation-requests.test.ts`
**Purpose**: Verify backend error handling in group creation requests
**Test Count**: 26 tests organized into 7 categories

**Note**: A symlink exists at `/convex -> apps/convex` for backwards compatibility.

**Categories**:
- Duplicate Request Prevention (3 tests)
- Invalid Group Type (4 tests)
- Invalid Proposed Leader IDs (6 tests)
- String Length Validation (4 tests)
- Request Not Found (3 tests)
- Request Already Processed (3 tests)
- Permission Checks (2 tests)
- Summary (1 test)

**Run Command**:
```bash
cd apps/convex
pnpm test error-handling-group-creation-requests
```

### 2. Frontend Hook Tests
**Location**: `/apps/mobile/features/groups/hooks/__tests__/useRequestGroup.error-handling.test.ts`
**Purpose**: Verify error handling in the useRequestGroup hook
**Test Count**: 15 tests organized into 6 categories

**Categories**:
- Error Propagation (4 tests)
- Loading State Management (3 tests)
- Error State Tracking (3 tests)
- Authentication Checks (4 tests)
- User-Friendly Error Messages (2 tests)
- Summary (1 test)

**Run Command**:
```bash
cd apps/mobile
pnpm test useRequestGroup.error-handling
```

### 3. Frontend Component Tests
**Location**: `/apps/mobile/features/groups/components/__tests__/RequestGroupScreen.error-handling.test.tsx`
**Purpose**: Verify UI error handling in RequestGroupScreen component
**Test Count**: 22 tests organized into 7 categories

**Categories**:
- Generic Error Handling (4 tests)
- Pending Request Prevention (3 tests)
- Character Limit Enforcement (4 tests)
- Invalid Leader Handling (2 tests)
- Loading State Management (3 tests)
- Form Field Validation (3 tests)
- Summary (1 test)

**Run Command**:
```bash
cd apps/mobile
pnpm test RequestGroupScreen.error-handling
```

**Note**: Currently blocked by test environment setup issues.

## Expected Test Results

### Current State (Before Fixes)

#### Backend Tests: 9 failing, 17 passing
**Failing tests indicate**:
- Test setup issues with ID formats (most failures)
- Some legitimate bugs in error message specificity

**Passing tests prove**:
- Duplicate request prevention works
- String length validation works
- Permission checks work
- Status validation works

#### Hook Tests: 4 failing, 11 passing
**Failing tests indicate**:
- Loading state not tracked (CRITICAL BUG)
- Error state not stored (CRITICAL BUG)

**Passing tests prove**:
- Error propagation works
- Alert.alert shown correctly
- Authentication validation works
- Error message mapping works

#### Component Tests: Cannot run
**Blocked by**: React Native module mocking issues

### After Fixes Are Implemented

All tests should pass, proving:
- ✅ All errors show user-friendly messages
- ✅ Loading states work correctly
- ✅ Error states are properly managed
- ✅ Form validation prevents bad submissions
- ✅ Authentication is verified before actions
- ✅ Permission checks are enforced

## Test Patterns Used

### Backend Tests (Convex)
```typescript
// Pattern: Test error throwing
await expect(
  t.mutation(api.functions.groupCreationRequests.create, {
    // invalid parameters
  })
).rejects.toThrow("Expected error message");

// Pattern: Test success case
const result = await t.mutation(api.functions.groupCreationRequests.create, {
  // valid parameters
});
expect(result).toBeDefined();
```

### Frontend Hook Tests
```typescript
// Pattern: Test error state
const { result } = renderHook(() => useRequestGroup());
await act(async () => {
  try {
    await result.current.requestGroupAsync({ /* params */ });
  } catch (error) {
    // Expected to throw
  }
});
expect(result.current.error).toBeTruthy();

// Pattern: Test Alert.alert
await act(async () => {
  await result.current.requestGroup({ /* params */ });
});
expect(Alert.alert).toHaveBeenCalledWith(
  "Error",
  expect.stringContaining("expected message")
);
```

### Frontend Component Tests
```typescript
// Pattern: Test form validation
const { getByTestId } = render(<RequestGroupScreen />);
fireEvent.changeText(getByTestId("input-name"), "invalid value");
fireEvent.press(getByTestId("button"));

await waitFor(() => {
  expect(Alert.alert).toHaveBeenCalled();
});
```

## Common Test Issues

### Issue: "Validator error: Expected ID for table..."
**Cause**: Test uses invalid ID format
**Fix**: Use proper Convex ID from test setup
```typescript
// Wrong
const fakeId = "invalid-id" as Id<"groups">;

// Right
const fakeId = await ctx.db.insert("groups", { /* data */ });
```

### Issue: "isRequesting is always false"
**Cause**: Hook returns hardcoded `false`
**Fix**: Implement loading state tracking in hook

### Issue: "error is always null"
**Cause**: Hook returns hardcoded `null`
**Fix**: Implement error state management in hook

### Issue: "Cannot find module 'expo-location'"
**Cause**: React Native module not mocked in tests
**Fix**: Add proper mock in test setup

## Test-Driven Development Workflow

1. **Write failing test** (already done)
2. **Run test to confirm it fails**
3. **Implement fix**
4. **Run test to confirm it passes**
5. **Refactor if needed**
6. **Commit with test**

## Priority Test Fixes

### Fix Loading State (P0)
**File**: `/apps/mobile/features/groups/hooks/useRequestGroup.ts`
**Test**: "should track loading state during mutation"
**Current**: Returns hardcoded `false`
**Expected**: Track actual mutation pending state

### Fix Error State (P0)
**File**: `/apps/mobile/features/groups/hooks/useRequestGroup.ts`
**Test**: "should store error in state after failure"
**Current**: Returns hardcoded `null`
**Expected**: Store and return error details

### Fix Test IDs (P1)
**Files**: Backend test file
**Tests**: Leader validation tests
**Current**: Use string IDs
**Expected**: Use proper Convex IDs

### Fix Test Environment (P1)
**Files**: Frontend component tests
**Current**: Module mocking issues
**Expected**: Proper React Native mocks

## Useful Commands

```bash
# Run all backend tests
cd apps/convex && pnpm test

# Run all mobile tests
cd apps/mobile && pnpm test

# Run specific test file
pnpm test error-handling

# Run tests in watch mode
pnpm test --watch

# Run tests with coverage
pnpm test --coverage

# Run tests matching pattern
pnpm test "useRequestGroup"
```

## Related Documentation

- **Error Handling Audit**: `/docs/error-handling-audit.md`
  - Detailed analysis of error scenarios
  - Impact assessment
  - Priority assignments

- **Test Results**: `/docs/error-handling-test-results.md`
  - Comprehensive test run results
  - Detailed failure analysis
  - Fix recommendations

- **Main Codebase Documentation**: `/CLAUDE.md`
  - TDD workflow
  - Testing standards
  - Code philosophy

## Maintenance

### When to Update These Tests

1. **When adding new error scenarios**
   - Add corresponding test case
   - Document expected behavior
   - Verify test fails before implementing

2. **When changing error messages**
   - Update test expectations
   - Ensure messages remain user-friendly
   - Update documentation

3. **When refactoring error handling**
   - Tests should pass after refactoring
   - If tests fail, either fix code or update tests
   - Document any behavior changes

### Test Health Checks

Run periodically to ensure tests remain relevant:

```bash
# Check test coverage
cd apps/convex && pnpm test --coverage

# Check for skipped/todo tests
grep -r "test.skip\|test.todo" apps/convex/__tests__/

# Check for outdated test patterns
# Review and update as needed
```

## Success Criteria

Tests are considered successful when:
- ✅ All backend tests pass (26/26)
- ✅ All hook tests pass (15/15)
- ✅ All component tests pass (22/22)
- ✅ No skipped tests
- ✅ Error handling is user-friendly
- ✅ Loading states work correctly
- ✅ Error states are properly managed
- ✅ Coverage meets requirements (>80%)

## Contact & Support

For questions about these tests:
1. Review the audit document first
2. Check test results document for common issues
3. Review this guide for test patterns
4. Check existing tests for examples
5. Refer to CLAUDE.md for TDD workflow

---

**Last Updated**: 2026-01-12
**Status**: Initial test suite created
**Next Review**: After P0 fixes are implemented
