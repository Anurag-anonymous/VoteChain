import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { authService, userService } from '../services';
import { useAuthStore } from '../store/authStore';

const initialForm = {
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  aadharNumber: '',
  walletAddress: '',
  walletPrivateKey: '',
  password: '',
  confirmPassword: ''
};

const initialStatus = {
  emailVerified: false,
  phoneVerified: false,
  aadharVerified: false
};

const RegisterPage = () => {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [step, setStep] = useState('register');
  const [loading, setLoading] = useState(false);
  const [generatingWallet, setGeneratingWallet] = useState(false);
  const [userId, setUserId] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [otps, setOtps] = useState({ email: '', phone: '', aadhar: '' });
  const [devOtps, setDevOtps] = useState({});
  const [status, setStatus] = useState(initialStatus);

  const updateForm = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const updateOtp = (name, value) => {
    setOtps((prev) => ({ ...prev, [name]: value.replace(/\D/g, '').slice(0, 6) }));
  };

  const handleGenerateWalletAddress = async () => {
    if (formData.walletAddress) {
      toast.info('Wallet address is already generated and cannot be changed');
      return;
    }

    setGeneratingWallet(true);
    try {
      const response = await userService.generateWalletAddress();
      setFormData((prev) => ({
        ...prev,
        walletAddress: response.data.walletAddress,
        walletPrivateKey: response.data.walletPrivateKey || ''
      }));
      toast.success('Wallet address generated successfully');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to generate wallet address');
    } finally {
      setGeneratingWallet(false);
    }
  };

  const validateForm = () => {
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phoneNumber || !formData.aadharNumber || !formData.password) {
      toast.error('All fields are required');
      return false;
    }

    if (formData.walletAddress && !/^0x[a-fA-F0-9]{40}$/.test(formData.walletAddress)) {
      toast.error('Wallet address must be a valid 40-character 0x-prefixed address');
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return false;
    }

    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return false;
    }

    if (!/^\d{10}$/.test(formData.phoneNumber)) {
      toast.error('Phone number must be 10 digits');
      return false;
    }
    if (!/^\d{12}$/.test(formData.aadharNumber)) {
      toast.error('Aadhaar number must be 12 digits');
      return false;
    }

    return true;
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      const response = await authService.register({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phoneNumber: formData.phoneNumber,
        aadharNumber: formData.aadharNumber,
        walletAddress: formData.walletAddress || undefined,
        walletPrivateKey: formData.walletPrivateKey || undefined,
        password: formData.password
      });

      setUserId(response.data.userId);
      setDevOtps(response.data.devOtps || {});
      setStatus(response.data.verificationStatus || initialStatus);
      setStep('verify');
      toast.success(response.data.message || 'OTPs sent');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const verifyChannel = async (channel) => {
    if (!otps[channel] || otps[channel].length !== 6) {
      toast.error(`Enter the 6-digit ${channel} OTP`);
      return;
    }

    const handlers = {
      email: authService.verifyEmailOTP,
      phone: authService.verifyPhoneOTP,
      aadhar: authService.verifyAadhaarOTP
    };

    const handler = handlers[channel];
    if (!handler) {
      toast.error(`Unsupported verification channel: ${channel}`);
      return;
    }

    setLoading(true);
    try {
      const response = await handler({ userId, otp: otps[channel] });
      setStatus(response.data.verificationStatus || status);
      toast.success(response.data.message);

      const nextStatus = response.data.verificationStatus || status;
      if (response.data.fullyVerified || (nextStatus.emailVerified && nextStatus.phoneVerified && nextStatus.aadharVerified)) {
        const loginResponse = await authService.login({
          email: formData.email,
          password: formData.password
        });
        setAuth(loginResponse.data.token, loginResponse.data.refreshToken, loginResponse.data.user);
        toast.success('All verification complete. You are logged in.');
        navigate('/dashboard');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || `${channel} verification failed`);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setLoading(true);
    try {
      const response = await authService.resendOTP({ userId });
      setDevOtps(response.data.devOtps || response.data.devOtp || {});
      toast.success(response.data.message || 'New OTPs sent');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to resend OTPs');
    } finally {
      setLoading(false);
    }
  };

  const renderOtpRow = (channel, label, target, verified) => (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-gray-900">{label}</h3>
          <p className="text-sm text-gray-600">{target}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {verified ? 'Verified' : 'Pending'}
        </span>
      </div>
      {devOtps[channel] && !verified && (
        <div className="mb-3 bg-indigo-50 border border-indigo-100 rounded-md px-3 py-2">
          <p className="text-xs font-semibold uppercase text-indigo-600">Development OTP</p>
          <p className="text-xl font-bold tracking-widest text-gray-900">{devOtps[channel]}</p>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={otps[channel]}
          onChange={(event) => updateOtp(channel, event.target.value)}
          placeholder="6-digit OTP"
          disabled={verified}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600 tracking-widest"
        />
        <button
          type="button"
          onClick={() => verifyChannel(channel)}
          disabled={loading || verified}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition disabled:opacity-50"
        >
          Verify
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 py-12 px-4">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-2xl">
        <h1 className="text-3xl font-bold mb-2 text-center text-indigo-600">VoteChain</h1>
        <p className="text-center text-gray-600 mb-8">
          {step === 'register' ? 'Create your secure voting account' : 'Verify email, phone, and Aadhaar'}
        </p>

        {step === 'register' ? (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input type="text" name="firstName" placeholder="First Name" value={formData.firstName} onChange={updateForm} required className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
              <input type="text" name="lastName" placeholder="Last Name" value={formData.lastName} onChange={updateForm} required className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
            </div>
            <input type="email" name="email" placeholder="Email" value={formData.email} onChange={updateForm} required className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
            <input type="tel" name="phoneNumber" placeholder="Phone Number (10 digits)" value={formData.phoneNumber} onChange={updateForm} maxLength="10" required className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
            <input type="text" name="aadharNumber" placeholder="Aadhaar Number (12 digits)" value={formData.aadharNumber} onChange={updateForm} maxLength="12" required className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
            <div className="flex gap-2">
              <input type="text" name="walletAddress" placeholder="Wallet Address (optional, 0x...)" value={formData.walletAddress} onChange={updateForm} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
              <button
                type="button"
                onClick={handleGenerateWalletAddress}
                disabled={generatingWallet || !!formData.walletAddress}
                className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-200 transition disabled:opacity-50"
              >
                {generatingWallet ? 'Generating...' : formData.walletAddress ? 'Wallet Generated' : 'Generate Wallet Address'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input type="password" name="password" placeholder="Password" value={formData.password} onChange={updateForm} required className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
              <input type="password" name="confirmPassword" placeholder="Confirm Password" value={formData.confirmPassword} onChange={updateForm} required className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600" />
            </div>
            <button type="submit" disabled={loading} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition disabled:opacity-50">
              {loading ? 'Sending OTPs...' : 'Register and Send OTPs'}
            </button>
            <p className="text-center text-gray-600">
              Already have an account? <Link to="/login" className="text-indigo-600 hover:underline">Login</Link>
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            {renderOtpRow('email', 'Email OTP', formData.email, status.emailVerified)}
            {renderOtpRow('phone', 'Phone OTP', formData.phoneNumber, status.phoneVerified)}
            {renderOtpRow('aadhar', 'Aadhaar OTP', 'Aadhaar-linked mobile verification', status.aadharVerified)}
            <button type="button" onClick={handleResendOTP} disabled={loading} className="w-full px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg font-bold hover:bg-indigo-50 transition disabled:opacity-50">
              Resend OTPs
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegisterPage;
