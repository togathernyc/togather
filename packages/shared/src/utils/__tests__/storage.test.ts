// Note: Storage tests are simplified due to platform detection at module load time
// The storage module detects web vs mobile at import time, making it difficult to test both in the same file
// These tests focus on the web implementation

describe('Storage (Web)', () => {
  let storage: typeof import('../storage').storage;
  const mockLocalStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock window and localStorage for web environment
    (global as any).window = {
      localStorage: mockLocalStorage,
    };
    (global as any).localStorage = mockLocalStorage;
  });

  afterEach(async () => {
    delete (global as any).window;
    delete (global as any).localStorage;
    jest.resetModules();
  });

  describe('getItem', () => {
    it('should get item from localStorage on web', async () => {
      mockLocalStorage.getItem.mockReturnValue('test-value');
      const storageModule = await import('../storage');
      storage = storageModule.storage;
      
      const result = await storage.getItem('test-key');
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('test-key');
      expect(result).toBe('test-value');
    });

    it('should return null when item does not exist', async () => {
      mockLocalStorage.getItem.mockReturnValue(null);
      const storageModule = await import('../storage');
      storage = storageModule.storage;
      
      const result = await storage.getItem('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('setItem', () => {
    it('should set item in localStorage on web', async () => {
      const storageModule = await import('../storage');
      storage = storageModule.storage;
      
      await storage.setItem('test-key', 'test-value');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('test-key', 'test-value');
    });
  });

  describe('removeItem', () => {
    it('should remove item from localStorage on web', async () => {
      const storageModule = await import('../storage');
      storage = storageModule.storage;
      
      await storage.removeItem('test-key');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('test-key');
    });
  });
});
