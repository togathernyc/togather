// Jest matchers are now built into @testing-library/react-native v12.4+

// Mock @sentry/react-native to avoid ESM issues
const mockSentryFunctions = {
  init: jest.fn(),
  wrap: jest.fn((component) => component),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  withScope: jest.fn((callback) => callback({ setExtra: jest.fn(), setExtras: jest.fn() })),
  Severity: {
    Fatal: 'fatal',
    Error: 'error',
    Warning: 'warning',
    Info: 'info',
    Debug: 'debug',
  },
  reactNativeTracingIntegration: jest.fn(() => ({})),
  reactNavigationIntegration: jest.fn(() => ({})),
};

jest.mock('@sentry/react-native', () => mockSentryFunctions);

// Mock @sentry/browser (JS-only fallback) with same interface
jest.mock('@sentry/browser', () => mockSentryFunctions);

// Mock superjson to avoid ESM issues (still needed for some dependencies)
jest.mock('superjson', () => ({
  __esModule: true,
  default: {
    serialize: jest.fn((data) => ({ json: data, meta: undefined })),
    deserialize: jest.fn((data) => data.json || data),
    stringify: jest.fn((data) => JSON.stringify(data)),
    parse: jest.fn((data) => JSON.parse(data)),
  },
  serialize: jest.fn((data) => ({ json: data, meta: undefined })),
  deserialize: jest.fn((data) => data.json || data),
  stringify: jest.fn((data) => JSON.stringify(data)),
  parse: jest.fn((data) => JSON.parse(data)),
}));

// Mock Convex React hooks
jest.mock('convex/react', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(() => jest.fn()),
  useAction: jest.fn(() => jest.fn()),
  useConvex: jest.fn(),
  useConvexAuth: jest.fn(() => ({
    isLoading: false,
    isAuthenticated: true,
  })),
  usePaginatedQuery: jest.fn(() => ({
    results: [],
    status: 'Exhausted',
    loadMore: jest.fn(),
    isLoading: false,
  })),
  useConvexConnectionState: jest.fn(() => ({
    isWebSocketConnected: true,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    failedConnectionCount: 0,
  })),
  ConvexProvider: ({ children }) => children,
  ConvexReactClient: jest.fn(() => ({
    query: jest.fn(),
    mutation: jest.fn(),
    action: jest.fn(),
  })),
}));

// Mock Convex browser HTTP client
jest.mock('convex/browser', () => ({
  ConvexHttpClient: jest.fn(() => ({
    query: jest.fn(),
    mutation: jest.fn(),
    action: jest.fn(),
  })),
}));

// Mock Convex client service
jest.mock('./services/api/convex', () => ({
  getConvexClient: jest.fn(() => ({
    query: jest.fn(),
    mutation: jest.fn(),
    action: jest.fn(),
  })),
  getConvexHttpClient: jest.fn(() => ({
    query: jest.fn(),
    mutation: jest.fn(),
    action: jest.fn(),
  })),
  convexVanilla: {
    query: jest.fn(),
    mutation: jest.fn(),
    action: jest.fn(),
  },
  authenticatedConvexVanilla: {
    query: jest.fn(),
    mutation: jest.fn(),
    action: jest.fn(),
  },
  ConvexProvider: ({ children }) => children,
  useQuery: jest.fn(),
  useMutation: jest.fn(() => jest.fn()),
  useAction: jest.fn(() => jest.fn()),
  useConvex: jest.fn(),
  usePaginatedQuery: jest.fn(() => ({
    results: [],
    status: 'Exhausted',
    loadMore: jest.fn(),
    isLoading: false,
  })),
  // Authenticated hooks - these automatically inject auth token
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(() => jest.fn()),
  useAuthenticatedAction: jest.fn(() => jest.fn()),
  useConvexConnectionState: jest.fn(() => ({
    isWebSocketConnected: true,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    failedConnectionCount: 0,
  })),
  useStoredAuthToken: jest.fn(() => 'mock-auth-token'),
  useTokenSync: jest.fn(() => 'mock-auth-token'),
  api: {},
}));

// Mock Convex generated API (empty object, tests can override with specific mocks)
jest.mock('../../../convex/_generated/api', () => ({
  api: {
    functions: {
      users: {},
      groups: {},
      meetings: {},
      notifications: {},
      auth: {},
    },
  },
}), { virtual: true });

// Legacy tRPC mock - keeping for backwards compatibility with existing tests
// TODO: Remove this once all tests are migrated to Convex
// Using { virtual: true } because the trpc.ts file has been removed
jest.mock('@services/api/trpc', () => ({
  trpc: {
    users: {
      me: { query: jest.fn() },
    },
    groups: {
      list: { query: jest.fn() },
      get: { query: jest.fn() },
    },
    meetings: {
      list: { query: jest.fn() },
    },
  },
  trpcVanilla: {
    users: {
      me: { query: jest.fn() },
    },
    groups: {
      list: { query: jest.fn() },
      get: { query: jest.fn() },
    },
    meetings: {
      list: { query: jest.fn() },
    },
    chat: {
      getToken: { query: jest.fn() },
    },
    notifications: {
      markRead: { mutate: jest.fn() },
    },
  },
  getTrpcClient: jest.fn(() => ({
    users: {
      me: { query: jest.fn() },
    },
  })),
}), { virtual: true });

// Mock React Native bridge
global.__fbBatchedBridgeConfig = {
  remoteModuleConfig: [],
  localModulesConfig: [],
};

// Initialize globalThis.expo before jest-expo tries to use it
if (typeof globalThis !== 'undefined' && !globalThis.expo) {
  globalThis.expo = {
    EventEmitter: class EventEmitter {
      constructor() {
        this.listeners = {};
      }
      addListener(event, listener) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(listener);
        return { remove: () => {} };
      }
      removeListener(event, listener) {
        if (this.listeners[event]) {
          this.listeners[event] = this.listeners[event].filter(l => l !== listener);
        }
      }
      emit(event, ...args) {
        if (this.listeners[event]) {
          this.listeners[event].forEach(listener => listener(...args));
        }
      }
    },
    NativeModule: class NativeModule {},
    SharedObject: class SharedObject {},
  };
}

// Mock @expo/vector-icons to avoid ESM import issues
jest.mock('@expo/vector-icons', () => ({
  Ionicons: jest.fn(({ name, size, color, ...props }) => {
    const React = require('react');
    return React.createElement('Text', { ...props }, name || 'icon');
  }),
}));

// Mock expo-media-library to avoid native module errors
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  createAssetAsync: jest.fn(() => Promise.resolve({ id: 'mock-asset-id' })),
}));

// Mock expo-file-system to avoid native module errors
jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///mock-cache/',
  documentDirectory: 'file:///mock-documents/',
  downloadAsync: jest.fn(() => Promise.resolve({ uri: 'file:///mock-cache/image.jpg' })),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: true, isDirectory: false })),
  readAsStringAsync: jest.fn(() => Promise.resolve('')),
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  copyAsync: jest.fn(() => Promise.resolve()),
  moveAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-file-system/legacy to avoid native module errors
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///mock-cache/',
  documentDirectory: 'file:///mock-documents/',
  downloadAsync: jest.fn(() => Promise.resolve({ uri: 'file:///mock-cache/image.jpg' })),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: true, isDirectory: false })),
  readAsStringAsync: jest.fn(() => Promise.resolve('')),
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  copyAsync: jest.fn(() => Promise.resolve()),
  moveAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-image-picker to avoid native module errors
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [] })),
  MediaTypeOptions: {
    Images: 'Images',
  },
}));

// Mock expo-constants to avoid native module errors
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

// Mock expo-clipboard to avoid native module errors
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve(true)),
  getStringAsync: jest.fn(() => Promise.resolve('')),
  hasStringAsync: jest.fn(() => Promise.resolve(false)),
  setString: jest.fn(),
  getString: jest.fn(() => ''),
  hasString: jest.fn(() => false),
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Suppress console errors in tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};

// Initialize API client for tests
// This must be done before any API services are imported
const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  request: jest.fn(),
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  },
};

// Make mockClient available globally for tests
global.mockApiClient = mockClient;

jest.mock('@togather/shared/api/instance', () => {
  let mockApiClientInstance = {
    getClient: () => mockClient,
    getBaseUrl: () => 'http://localhost:8000',
    getCommunityId: jest.fn(() => Promise.resolve('123')),
  };

  return {
    initializeApiClient: jest.fn((config) => {
      mockApiClientInstance = {
        getClient: () => mockClient,
        getBaseUrl: () => config.baseURL,
        getCommunityId: config.getCommunityId || (() => Promise.resolve('123')),
      };
      return mockApiClientInstance;
    }),
    getApiClient: () => {
      if (!mockApiClientInstance) {
        // Auto-initialize with default config if not initialized
        mockApiClientInstance = {
          getClient: () => mockClient,
          getBaseUrl: () => 'http://localhost:8000',
          getCommunityId: () => Promise.resolve('123'),
        };
      }
      return mockApiClientInstance;
    },
    getClient: () => {
      const instance = require('@togather/shared/api/instance').getApiClient();
      return instance.getClient();
    },
    getCommunityId: () => {
      const instance = require('@togather/shared/api/instance').getApiClient();
      return instance.getCommunityId();
    },
  };
});

// Auto-initialize API client for all tests
const { initializeApiClient } = require('@togather/shared/api/instance');
initializeApiClient({
  baseURL: 'http://localhost:8000',
  getCommunityId: () => Promise.resolve('123'),
});

// Mock the shared storage
jest.mock('@togather/shared/utils/storage', () => ({
  storage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock react-native-reanimated to support components that use it
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Mock @gorhom/bottom-sheet to support BottomSheet components in tests
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const ReactNative = require('react-native');

  const BottomSheet = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      snapToIndex: jest.fn(),
      snapToPosition: jest.fn(),
      expand: jest.fn(),
      collapse: jest.fn(),
      close: jest.fn(),
      forceClose: jest.fn(),
    }));

    return props.children;
  });

  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetFlatList: ReactNative.FlatList,
    BottomSheetScrollView: ReactNative.ScrollView,
    BottomSheetView: ({ children }) => children,
    BottomSheetTextInput: ReactNative.TextInput,
  };
});
