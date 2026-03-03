import { initializeApiClient, getApiClient, getClient, getCommunityId } from '../instance';
import { createApiClient } from '../client';

jest.mock('../client');

const mockCreateApiClient = createApiClient as jest.MockedFunction<typeof createApiClient>;

describe('API Instance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the module to clear the singleton instance
    jest.resetModules();
  });

  describe('initializeApiClient', () => {
    it('should initialize the API client', () => {
      const mockClient = {
        getClient: jest.fn(),
        getBaseUrl: jest.fn(),
        getCommunityId: jest.fn(),
      };
      mockCreateApiClient.mockReturnValue(mockClient as any);

      const result = initializeApiClient({
        baseURL: 'https://api.example.com',
      });

      expect(mockCreateApiClient).toHaveBeenCalledWith({
        baseURL: 'https://api.example.com',
      });
      expect(result).toBe(mockClient);
    });
  });

  describe('getApiClient', () => {
    it('should return initialized client', () => {
      const mockClient = {
        getClient: jest.fn(),
        getBaseUrl: jest.fn(),
        getCommunityId: jest.fn(),
      };
      mockCreateApiClient.mockReturnValue(mockClient as any);

      initializeApiClient({
        baseURL: 'https://api.example.com',
      });

      const result = getApiClient();
      expect(result).toBe(mockClient);
    });

    it('should throw error if client not initialized', () => {
      // Import fresh module to ensure no instance exists
      jest.resetModules();
      const { getApiClient: getClient } = require('../instance');

      expect(() => getClient()).toThrow(
        'API client not initialized. Call initializeApiClient() first.'
      );
    });
  });

  describe('getClient', () => {
    it('should return axios client from initialized instance', () => {
      const mockAxiosClient = { get: jest.fn(), post: jest.fn() };
      const mockClient = {
        getClient: jest.fn().mockReturnValue(mockAxiosClient),
        getBaseUrl: jest.fn(),
        getCommunityId: jest.fn(),
      };
      mockCreateApiClient.mockReturnValue(mockClient as any);

      initializeApiClient({
        baseURL: 'https://api.example.com',
      });

      const result = getClient();
      expect(result).toBe(mockAxiosClient);
      expect(mockClient.getClient).toHaveBeenCalled();
    });
  });

  describe('getCommunityId', () => {
    it('should return communityId from storage', async () => {
      const { storage } = require('../../utils/storage');
      jest.spyOn(storage, 'getItem').mockResolvedValue('123');

      const mockClient = {
        getClient: jest.fn(),
        getBaseUrl: jest.fn(),
        getCommunityId: jest.fn().mockResolvedValue('123'),
      };
      mockCreateApiClient.mockReturnValue(mockClient as any);

      initializeApiClient({
        baseURL: 'https://api.example.com',
      });

      const result = await getCommunityId();
      expect(result).toBe('123');
      expect(mockClient.getCommunityId).toHaveBeenCalled();
    });

    it('should fallback to current_community if newCommunityId not found', async () => {
      const mockClient = {
        getClient: jest.fn(),
        getBaseUrl: jest.fn(),
        getCommunityId: jest.fn().mockResolvedValue('456'),
      };
      mockCreateApiClient.mockReturnValue(mockClient as any);

      initializeApiClient({
        baseURL: 'https://api.example.com',
      });

      const result = await getCommunityId();
      expect(result).toBe('456');
    });

    it('should return null if no communityId found', async () => {
      const mockClient = {
        getClient: jest.fn(),
        getBaseUrl: jest.fn(),
        getCommunityId: jest.fn().mockResolvedValue(null),
      };
      mockCreateApiClient.mockReturnValue(mockClient as any);

      initializeApiClient({
        baseURL: 'https://api.example.com',
      });

      const result = await getCommunityId();
      expect(result).toBeNull();
    });
  });
});

