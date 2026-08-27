import api from './api';

const authService = {
  register: (data) => api.post('/auth/register', data),
  verifyOTP: (data) => api.post('/auth/verify-otp', data),
  resendOTP: (data) => api.post('/auth/resend-otp', data),
  login: (data) => api.post('/auth/login', data),
  resetPasswordRequest: (data) => api.post('/auth/reset-password-request', data),
  resetPassword: (data) => api.post('/auth/reset-password', data),
  logout: () => api.post('/auth/logout')
};

const pollService = {
  getAllPolls: (params) => api.get('/polls', { params }),
  getPoll: (id) => api.get(`/polls/${id}`),
  getPollResults: (id) => api.get(`/polls/${id}/results`),
  createPoll: (data) => api.post('/polls', data),
  vote: (pollId, data) => api.post(`/polls/${pollId}/vote`, data),
  closePoll: (id) => api.put(`/polls/${id}/close`),
  deletePoll: (id) => api.delete(`/polls/${id}`)
};

const discussionService = {
  getAllDiscussions: (params) => api.get('/discussions', { params }),
  getDiscussion: (id) => api.get(`/discussions/${id}`),
  createDiscussion: (data) => api.post('/discussions', data),
  addComment: (id, data) => api.post(`/discussions/${id}/comments`, data),
  addReply: (id, commentId, data) => api.post(`/discussions/${id}/comments/${commentId}/replies`, data),
  likeDiscussion: (id) => api.post(`/discussions/${id}/like`),
  unlikeDiscussion: (id) => api.post(`/discussions/${id}/unlike`),
  deleteDiscussion: (id) => api.delete(`/discussions/${id}`)
};

const userService = {
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data) => api.put('/users/profile', data),
  changePassword: (data) => api.post('/users/change-password', data),
  getUserStats: () => api.get('/users/stats'),
  linkWallet: (data) => api.post('/users/link-wallet', data),
  getPublicProfile: (userId) => api.get(`/users/${userId}/public`)
};

export {
  authService,
  pollService,
  discussionService,
  userService
};
