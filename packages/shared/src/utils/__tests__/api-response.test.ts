import { extractApiData, extractApiError } from '../api-response';
import { AxiosError } from 'axios';

describe('extractApiData', () => {
  it('should extract data from nested response structure', () => {
    const response = {
      data: {
        data: { id: 1, name: 'Test' },
        errors: [],
      },
    };
    const result = extractApiData(response);
    expect(result).toEqual({ id: 1, name: 'Test' });
  });

  it('should extract data from flat response structure', () => {
    const response = {
      data: { id: 1, name: 'Test' },
    };
    const result = extractApiData(response);
    expect(result).toEqual({ id: 1, name: 'Test' });
  });

  it('should throw error when response contains errors', () => {
    const response = {
      data: {
        data: null,
        errors: ['Something went wrong'],
      },
    };
    expect(() => extractApiData(response)).toThrow('Something went wrong');
  });

  it('should throw error with nested error arrays', () => {
    const response = {
      data: {
        data: null,
        errors: [['Nested error']],
      },
    };
    expect(() => extractApiData(response)).toThrow('Nested error');
  });

  it('should handle deeply nested error arrays', () => {
    const response = {
      data: {
        data: null,
        errors: [[['Deeply nested error']]],
      },
    };
    expect(() => extractApiData(response)).toThrow('Deeply nested error');
  });

  it('should handle response without data property', () => {
    const response = { id: 1, name: 'Test' };
    const result = extractApiData(response);
    expect(result).toEqual({ id: 1, name: 'Test' });
  });
});

describe('extractApiError', () => {
  it('should extract error from errors array', () => {
    const error = {
      response: {
        data: {
          errors: ['Invalid credentials'],
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('Invalid credentials');
  });

  it('should extract error from processed error format', () => {
    const error = {
      response: {
        data: {
          errors: ['email: This field is required'],
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('email: This field is required');
  });

  it('should extract error from nested error arrays', () => {
    const error = {
      response: {
        data: {
          errors: [['Nested error message']],
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('Nested error message');
  });

  it('should extract error from deeply nested arrays', () => {
    const error = {
      response: {
        data: {
          errors: [[['Deeply nested error']]],
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('Deeply nested error');
  });

  it('should extract error from errors object (field-level errors)', () => {
    const error = {
      response: {
        data: {
          errors: {
            email: ['This field is required'],
            password: ['This field is too short'],
          },
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('email: This field is required');
  });

  it('should extract error from detail field', () => {
    const error = {
      response: {
        data: {
          detail: 'Authentication credentials were not provided',
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('Authentication credentials were not provided');
  });

  it('should extract error from non_field_errors', () => {
    const error = {
      response: {
        data: {
          non_field_errors: ['Unable to log in with provided credentials'],
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('Unable to log in with provided credentials');
  });

  it('should fallback to error message when no response data', () => {
    const error = {
      message: 'Network error',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('Network error');
  });

  it('should fallback to default message when no error message', () => {
    const error = {} as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('An error occurred. Please try again.');
  });

  it('should handle empty errors array', () => {
    const error = {
      response: {
        data: {
          errors: [],
        },
      },
      message: 'Request failed',
    } as AxiosError;
    const result = extractApiError(error);
    expect(result).toBe('Request failed');
  });
});

