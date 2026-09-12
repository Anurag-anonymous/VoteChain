import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { pollService } from '../services';
import { useAuthStore } from '../store/authStore';

const initialOptions = ['', ''];

const CreatePollPage = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'other',
    endDate: '',
    walletAddress: user?.walletAddress || '',
    tags: ''
  });

  useEffect(() => {
    if (user?.walletAddress && !formData.walletAddress) {
      setFormData((prev) => ({
        ...prev,
        walletAddress: user.walletAddress
      }));
    }
  }, [user, formData.walletAddress]);
  const [options, setOptions] = useState(initialOptions);

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleOptionChange = (index, value) => {
    const updatedOptions = [...options];
    updatedOptions[index] = value;
    setOptions(updatedOptions);
  };

  const addOption = () => {
    if (options.length < 10) {
      setOptions((prev) => [...prev, '']);
    }
  };

  const removeOption = (index) => {
    if (options.length > 2) {
      const updatedOptions = options.filter((_, optionIndex) => optionIndex !== index);
      setOptions(updatedOptions);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const linkedWalletAddress = user?.walletAddress || formData.walletAddress;

    if (!formData.title || !formData.description || !formData.endDate || !linkedWalletAddress) {
      toast.error('Please fill in all required fields');
      return;
    }

    const trimmedOptions = options.map((option) => option.trim()).filter(Boolean);

    if (trimmedOptions.length < 2) {
      toast.error('Please add at least two valid poll options');
      return;
    }

    if (trimmedOptions.length !== new Set(trimmedOptions).size) {
      toast.error('Poll options must be unique');
      return;
    }

    const endDateValue = new Date(formData.endDate);
    if (Number.isNaN(endDateValue.getTime()) || endDateValue <= new Date()) {
      toast.error('Poll end date must be in the future');
      return;
    }

    try {
      setLoading(true);

      const payload = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        options: trimmedOptions,
        category: formData.category,
        tags: formData.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        endDate: endDateValue.toISOString(),
        walletAddress: linkedWalletAddress
      };

      const response = await pollService.createPoll(payload);

      toast.success(response.data?.message || 'Poll created successfully');
      navigate('/polls');
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Failed to create poll');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Create New Poll</h1>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-md space-y-5">
        <div>
          <label className="block font-semibold mb-2 text-gray-700">Poll Title</label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleFieldChange}
            placeholder="Enter poll title"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            required
          />
        </div>

        <div>
          <label className="block font-semibold mb-2 text-gray-700">Description</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleFieldChange}
            rows="4"
            placeholder="Describe the purpose of this poll"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold mb-2 text-gray-700">Category</label>
            <select
              name="category"
              value={formData.category}
              onChange={handleFieldChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            >
              <option value="political">Political</option>
              <option value="social">Social</option>
              <option value="educational">Educational</option>
              <option value="sports">Sports</option>
              <option value="entertainment">Entertainment</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-2 text-gray-700">Poll End Date</label>
            <input
              type="datetime-local"
              name="endDate"
              value={formData.endDate}
              onChange={handleFieldChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
              required
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold mb-2 text-gray-700">Wallet Address</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              name="walletAddress"
              value={user?.walletAddress || formData.walletAddress}
              readOnly
              placeholder="Generated wallet appears after registration"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
              required
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Polls are signed with your one-time generated local Anvil wallet. MetaMask addresses are not used for this local chain workflow.
          </p>
        </div>

        <div>
          <label className="block font-semibold mb-2 text-gray-700">Poll Options</label>
          <div className="space-y-3">
            {options.map((option, index) => (
              <div key={index} className="flex gap-3">
                <input
                  type="text"
                  value={option}
                  onChange={(event) => handleOptionChange(index, event.target.value)}
                  placeholder={`Option ${index + 1}`}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
                />

                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="px-3 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addOption}
            disabled={options.length >= 10}
            className="mt-3 px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Option
          </button>
        </div>

        <div>
          <label className="block font-semibold mb-2 text-gray-700">Tags</label>
          <input
            type="text"
            name="tags"
            value={formData.tags}
            onChange={handleFieldChange}
            placeholder="comma separated tags (optional)"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {loading ? 'Creating Poll...' : 'Create Poll'}
        </button>
      </form>
    </div>
  );
};

export default CreatePollPage;
