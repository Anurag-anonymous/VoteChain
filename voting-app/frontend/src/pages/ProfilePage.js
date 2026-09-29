import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { userService } from '../services';
import { useAuthStore } from '../store/authStore';

const ProfilePage = () => {
  const { isAuthenticated, user, updateUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [generatingWallet, setGeneratingWallet] = useState(false);
  const [submittingEligibility, setSubmittingEligibility] = useState(false);
  const [anonymousCredential, setAnonymousCredential] = useState('');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    walletAddress: '',
    bio: '',
    profileImage: ''
  });

  useEffect(() => {
    const userId = user?.id;
    const loadProfile = async () => {
      if (!userId) return;
      try {
        const response = await userService.getProfile();
        const currentUser = useAuthStore.getState().user || {};
        const updatedUser = { ...currentUser, ...response.data.user };
        updateUser(updatedUser);
        setFormData({
          firstName: updatedUser.firstName || '',
          lastName: updatedUser.lastName || '',
          email: updatedUser.email || '',
          phoneNumber: updatedUser.phoneNumber || '',
          walletAddress: updatedUser.walletAddress || '',
          bio: updatedUser.bio || '',
          profileImage: updatedUser.profileImage || ''
        });
        if (response.data.user.eligibilityStatus === 'eligible') {
          const credentialResponse = await userService.getAnonymousCredential();
          setAnonymousCredential(credentialResponse.data.credential);
        }
      } catch (error) {
        if (error.response?.status !== 403) {
          toast.error(error.response?.data?.message || 'Could not load eligibility profile');
        }
      }
    };
    loadProfile();
  }, [user?.id, updateUser]);

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleGenerateWalletAddress = async () => {
    if (user?.walletAddress || formData.walletAddress) {
      toast.info('Wallet address is already generated and cannot be changed');
      return;
    }

    setGeneratingWallet(true);
    try {
      const response = await userService.generateWalletAddressForProfile();
      setFormData((prev) => ({ ...prev, walletAddress: response.data.walletAddress }));
      if (response.data.user) {
        updateUser(response.data.user);
      }
      toast.success('Wallet address generated successfully');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to generate wallet address');
    } finally {
      setGeneratingWallet(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setLoading(true);
      const profileData = { ...formData };
      delete profileData.walletAddress;
      const response = await userService.updateProfile(profileData);
      updateUser(response.data.user);
      toast.success('Profile updated successfully');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitEligibility = async () => {
    setSubmittingEligibility(true);
    try {
      const response = await userService.submitEligibilityApplication();
      updateUser({ ...user, eligibilityStatus: response.data.eligibilityStatus });
      toast.success(response.data.message || 'Eligibility case submitted for human review');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not submit eligibility case');
    } finally {
      setSubmittingEligibility(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">My Profile</h1>

      <div className="bg-white p-8 rounded-lg shadow-md">
        <section className="mb-8 rounded-lg border border-indigo-100 bg-indigo-50 p-5">
          <h2 className="text-lg font-semibold text-indigo-950">Voting eligibility</h2>
          <p className="mt-1 text-sm text-indigo-900">
            Status: <strong>{(user?.eligibilityStatus || 'pending').replace('_', ' ')}</strong>.
            An independent reviewer checks your submitted details; email, phone, and Aadhaar OTP checks alone do not grant voting eligibility.
          </p>
          {user?.eligibilityStatus !== 'eligible' && user?.eligibilityStatus !== 'rejected' && (
            <button
              type="button"
              onClick={handleSubmitEligibility}
              disabled={submittingEligibility}
              className="mt-3 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submittingEligibility ? 'Submitting...' : 'Submit or refresh eligibility review'}
            </button>
          )}
          {user?.eligibilityStatus === 'rejected' && (
            <p className="mt-3 text-sm text-red-800">
              Contact the Eligibility Authority through its published review channel if you believe this decision should be appealed.
            </p>
          )}
          {anonymousCredential && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-semibold text-emerald-950">Your anonymous voting credential</p>
              <p className="mt-1 text-xs text-emerald-900">
                This secret is used in your browser to prove eligibility without including it in the ballot request. Keep it private. VoteChain still knows which account is signed in; this prototype does not hide your identity from the backend.
              </p>
              <code className="mt-2 block break-all rounded bg-white p-3 text-xs">{anonymousCredential}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(anonymousCredential)}
                className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
              >
                Copy credential
              </button>
            </div>
          )}
        </section>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-indigo-50 p-4 rounded-lg">
            <p className="text-sm text-gray-500">Polls created</p>
            <p className="text-2xl font-bold text-indigo-700">{user?.pollsCreated || 0}</p>
          </div>
          <div className="bg-indigo-50 p-4 rounded-lg">
            <p className="text-sm text-gray-500">Votes cast</p>
            <p className="text-2xl font-bold text-indigo-700">{user?.votesCount || 0}</p>
          </div>
          <div className="bg-indigo-50 p-4 rounded-lg">
            <p className="text-sm text-gray-500">Wallet status</p>
            <p className="text-sm font-bold text-indigo-700">
              {user?.walletAddress ? 'Linked' : 'Not linked'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-semibold mb-2">First Name</label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Last Name</label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-semibold mb-2">Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-2">Phone Number</label>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Wallet Address</label>
            <div className="flex gap-2">
              <input
                type="text"
                name="walletAddress"
                value={formData.walletAddress}
                placeholder="0x..."
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
              />
              <button
                type="button"
                onClick={handleGenerateWalletAddress}
                disabled={generatingWallet || !!formData.walletAddress}
                className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-200 transition disabled:opacity-50"
              >
                {generatingWallet ? 'Generating...' : formData.walletAddress ? 'Wallet Locked' : 'Generate Wallet Address'}
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              This local Anvil wallet is generated once and cannot be changed. All poll creation and voting transactions use this address.
            </p>
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Profile Image URL</label>
            <input
              type="text"
              name="profileImage"
              value={formData.profileImage}
              onChange={handleChange}
              placeholder="https://example.com/profile.jpg"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            />
          </div>

          <div>
            <label className="block text-gray-700 font-semibold mb-2">Bio</label>
            <textarea
              name="bio"
              value={formData.bio}
              onChange={handleChange}
              rows="4"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ProfilePage;
