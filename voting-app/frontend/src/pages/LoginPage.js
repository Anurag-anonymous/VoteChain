import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService } from '../services';
import { useAuthStore } from '../store/authStore';
import { toast } from 'react-toastify';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  const [forgotData, setForgotData] = useState({
    email: '',
    aadharNumber: ''
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleForgotChange = (e) => {
    const { name, value } = e.target;
    setForgotData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      toast.error('Email and password are required');
      return;
    }

    setLoading(true);
    try {
      const response = await authService.login(formData);

      setAuth(
        response.data.token,
        response.data.refreshToken,
        response.data.user
      );

      toast.success('Login successful!');
      navigate(location.state?.from?.pathname || '/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();

    if (!forgotData.email || !forgotData.aadharNumber) {
      toast.error('Email and Aadhar number are required');
      return;
    }

    setLoading(true);
    try {
      await authService.resetPasswordRequest(forgotData);
      toast.success('Password reset OTP sent to your email');
      setShowForgot(false);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h1 className="text-3xl font-bold mb-2 text-center text-indigo-600">VoteChain</h1>
        <p className="text-center text-gray-600 mb-8">Secure Voting on Blockchain</p>

        {!showForgot ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={formData.email}
              onChange={handleInputChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            />

            <input
              type="password"
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleInputChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>

            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="w-full text-center text-indigo-600 hover:underline text-sm"
            >
              Forgot Password?
            </button>

            <p className="text-center text-gray-600">
              Don't have an account? <a href="/register" className="text-indigo-600 hover:underline">Register</a>
            </p>
          </form>
        ) : (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <h2 className="text-xl font-bold mb-4">Reset Password</h2>

            <input
              type="email"
              name="email"
              placeholder="Email"
              value={forgotData.email}
              onChange={handleForgotChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            />

            <input
              type="text"
              name="aadharNumber"
              placeholder="Aadhar Number (12 digits)"
              value={forgotData.aadharNumber}
              onChange={handleForgotChange}
              maxLength="12"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={() => setShowForgot(false)}
              className="w-full text-center text-indigo-600 hover:underline text-sm"
            >
              Back to Login
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
