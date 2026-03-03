import { createApiClient, ApiClientConfig } from '../client';
import { storage } from '../../utils/storage';

// Mock dependencies
jest.mock('../../utils/storage');

const mockStorage = storage as jest.Mocked<typeof storage>;

describe('ApiClient', () => {
  let apiClient: ReturnType<typeof createApiClient>;
  const baseConfig: ApiClientConfig = {
    baseURL: 'https://api.example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    apiClient = createApiClient(baseConfig);
    mockStorage.getItem.mockResolvedValue(null);
    mockStorage.setItem.mockResolvedValue(undefined);
  });

  describe('Initialization', () => {
    it('should create client with baseURL', () => {
      const client = apiClient.getClient();
      expect(client.defaults.baseURL).toBe('https://api.example.com');
    });

    it('should create client with custom timeout', () => {
      const client = createApiClient({ ...baseConfig, timeout: 5000 });
      expect(client.getClient().defaults.timeout).toBe(5000);
    });

    it('should use default timeout if not provided', () => {
      const client = apiClient.getClient();
      expect(client.defaults.timeout).toBe(10000);
    });
  });

  describe('getCommunityId', () => {
    it('should return communityId from custom function', async () => {
      const customGetCommunityId = jest.fn().mockResolvedValue('custom-id');
      const client = createApiClient({
        ...baseConfig,
        getCommunityId: customGetCommunityId,
      });

      const result = await client.getCommunityId();
      expect(result).toBe('custom-id');
      expect(customGetCommunityId).toHaveBeenCalled();
    });

    it('should return communityId from storage when no custom function', async () => {
      mockStorage.getItem.mockResolvedValue('123');
      const result = await apiClient.getCommunityId();
      expect(result).toBe('123');
      expect(mockStorage.getItem).toHaveBeenCalledWith('newCommunityId');
    });

    it('should fallback to current_community if newCommunityId not found', async () => {
      mockStorage.getItem
        .mockResolvedValueOnce(null) // newCommunityId
        .mockResolvedValueOnce('456'); // current_community

      const result = await apiClient.getCommunityId();
      expect(result).toBe('456');
      expect(mockStorage.getItem).toHaveBeenCalledWith('current_community');
    });

    it('should return null if no communityId found', async () => {
      mockStorage.getItem.mockResolvedValue(null);
      const result = await apiClient.getCommunityId();
      expect(result).toBeNull();
    });
  });

  describe('getBaseUrl', () => {
    it('should return the base URL', () => {
      expect(apiClient.getBaseUrl()).toBe('https://api.example.com');
    });
  });

  describe('getClient', () => {
    it('should return axios instance', () => {
      const client = apiClient.getClient();
      expect(client).toBeDefined();
      expect(client.defaults).toBeDefined();
      expect(client.defaults.baseURL).toBe('https://api.example.com');
    });
  });
});
