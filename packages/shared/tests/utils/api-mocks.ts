// MSW handlers for API mocking
// This will be used by both mobile and web tests

import { rest } from 'msw';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Mock user data
const mockUser = {
  id: 1,
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  church_id: 1,
};

// Mock members data
const mockMembers = [
  {
    id: 1,
    email: 'member1@example.com',
    first_name: 'Member',
    last_name: 'One',
    church_id: 1,
  },
  {
    id: 2,
    email: 'member2@example.com',
    first_name: 'Member',
    last_name: 'Two',
    church_id: 1,
  },
];

// Mock church settings
const mockChurchSettings = {
  id: 1,
  name: 'Test Church',
  church_id: 1,
};

export const handlers = [
  // Auth endpoints
  rest.post(`${API_BASE_URL}/auth/token/`, (req, res, ctx) => {
    // authApi.login uses extractApiData, so it can handle both formats
    // Return format that extractApiData expects: { data: {...}, errors: [] }
    return res(
      ctx.json({
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          user: mockUser,
        },
        errors: [],
      })
    );
  }),

  rest.post(`${API_BASE_URL}/auth/logout/`, (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  }),

  rest.get(`${API_BASE_URL}/auth/send-reset-password-email/`, (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  }),

  rest.post(`${API_BASE_URL}/auth/reset-forget-password/`, (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  }),

  rest.post(`${API_BASE_URL}/auth/validate-password-reset-key/`, (req, res, ctx) => {
    return res(ctx.json({ valid: true }));
  }),

  // Member endpoints - Updated to new API paths
  rest.get(`${API_BASE_URL}/api/users/me`, (req, res, ctx) => {
    // Return format that extractApiData expects: { data: {...}, errors: [] }
    return res(ctx.json({ data: mockUser, errors: [], page_info: null }));
  }),

  rest.get(`${API_BASE_URL}/api/churches/:churchId/member`, (req, res, ctx) => {
    // Paginated format: { results: [...], count: N }
    return res(
      ctx.json({
        results: mockMembers,
        count: mockMembers.length,
      })
    );
  }),

  rest.get(`${API_BASE_URL}/api/users/search`, (req, res, ctx) => {
    // searchMember endpoint - returns paginated format
    const search = req.url.searchParams.get('query');
    const filteredMembers = search
      ? mockMembers.filter(
          (m) =>
            m.email.toLowerCase().includes(search.toLowerCase()) ||
            m.first_name.toLowerCase().includes(search.toLowerCase()) ||
            m.last_name.toLowerCase().includes(search.toLowerCase())
        )
      : mockMembers;
    return res(
      ctx.json({
        results: filteredMembers,
        count: filteredMembers.length,
      })
    );
  }),

  // getMemberById uses /api/users/:id
  rest.get(`${API_BASE_URL}/api/users/:id`, (req, res, ctx) => {
    const { id } = req.params;
    const member = mockMembers.find((m) => m.id === Number(id));
    return res(ctx.json(member || mockMembers[0]));
  }),

  rest.post(`${API_BASE_URL}/api/users/auth/signup`, (req, res, ctx) => {
    return res(
      ctx.json({
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          user: mockUser,
        },
        errors: [],
      })
    );
  }),

  rest.patch(`${API_BASE_URL}/api/users/profile`, (req, res, ctx) => {
    return res(ctx.json({ data: mockUser, errors: [] }));
  }),

  rest.patch(`${API_BASE_URL}/api/users/memberships/:id/status`, (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  }),

  rest.post(`${API_BASE_URL}/api/users/guest`, (req, res, ctx) => {
    return res(ctx.json({ id: 3, ...req.body }));
  }),

  rest.put(`${API_BASE_URL}/member/change-avatar/`, (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  }),

  rest.patch(`${API_BASE_URL}/member/remove-avatar/`, (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  }),

  // Church endpoints - Updated to new API paths
  // adminApi.getChurchSettings uses extractApiData and expects { data: {...}, errors: [] }
  rest.get(`${API_BASE_URL}/api/churches/:churchId`, (req, res, ctx) => {
    return res(
      ctx.json({
        data: mockChurchSettings,
        errors: [],
      })
    );
  }),

  rest.patch(`${API_BASE_URL}/api/churches/:churchId`, (req, res, ctx) => {
    return res(
      ctx.json({
        id: 1,
        name: 'Updated Church',
        church_id: 1,
      })
    );
  }),

  rest.get(`${API_BASE_URL}/api/churches/locations`, (req, res, ctx) => {
    return res(ctx.json({ results: [], count: 0 }));
  }),

  rest.post(`${API_BASE_URL}/api/churches/locations`, (req, res, ctx) => {
    return res(ctx.json({ id: 1, name: 'New Location' }));
  }),

  rest.patch(`${API_BASE_URL}/api/churches/locations/:id`, (req, res, ctx) => {
    return res(ctx.json({ id: 1, name: 'Updated Location' }));
  }),

  rest.delete(`${API_BASE_URL}/api/churches/locations/:id`, (req, res, ctx) => {
    return res(ctx.json({ success: true }));
  }),

  rest.get(`${API_BASE_URL}/api/churches/search`, (req, res, ctx) => {
    return res(ctx.json({ page_info: null, data: [mockChurchSettings] }));
  }),

  rest.post(`${API_BASE_URL}/api/churches`, (req, res, ctx) => {
    return res(ctx.json({ id: 2, name: 'New Church' }));
  }),

  // Reports endpoints
  // adminApi.getNewSignUpStats returns response.data directly
  rest.get(`${API_BASE_URL}/reports/new-signups/stats/`, (req, res, ctx) => {
    return res(
      ctx.json({
        total_signups: 10,
        new_signups: 5,
        period: {
          start_date: '2024-01-01',
          end_date: '2024-01-31',
        },
      })
    );
  }),

  // adminApi.getTotalAttendanceStat uses extractApiData
  rest.get(`${API_BASE_URL}/reports/total-attendance/stats/`, (req, res, ctx) => {
    return res(
      ctx.json({
        data: {
          total_attendance: 100,
          average_attendance: 50,
          period: {
            start_date: '2024-01-01',
            end_date: '2024-01-31',
          },
        },
        errors: [],
      })
    );
  }),

  // adminApi.getLeaderAttendanceReport returns response.data directly
  rest.get(`${API_BASE_URL}/reports/leader-attendance-report/`, (req, res, ctx) => {
    return res(
      ctx.json({
        date: '2024-01-01',
        dinner_id: 1,
        attendance: [],
        total_attendance: 0,
      })
    );
  }),

  // Google/Apple login - Updated to new API paths
  // authApi.googleLogin uses extractApiData
  rest.post(`${API_BASE_URL}/api/users/auth/google`, (req, res, ctx) => {
    return res(
      ctx.json({
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          user: mockUser,
        },
        errors: [],
      })
    );
  }),

  // useAppleLogin uses extractApiData
  rest.post(`${API_BASE_URL}/api/users/auth/apple`, (req, res, ctx) => {
    return res(
      ctx.json({
        data: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          user: mockUser,
        },
        errors: [],
      })
    );
  }),

  // Payments endpoints - Updated to new API paths
  rest.get(`${API_BASE_URL}/api/payments/subscriptions/plans`, (req, res, ctx) => {
    return res(ctx.json({ data: [{ id: 1, name: 'Plan 1' }] }));
  }),
];

