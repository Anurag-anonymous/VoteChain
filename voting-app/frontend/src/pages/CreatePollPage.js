import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { pollService } from '../services';
import { useAuthStore } from '../store/authStore';

const initialOptions = ['', ''];
const paddedProtocols = ['c1p-revoting-padding', 'c2p-private-decoy-padding'];

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
    tags: '',
    protocolVersion: 'c0-encrypted',
    paddingRatePercent: '25',
    selectionStrategy: 'population-sample',
    timingDistribution: 'uniform',
    timingWindowSeconds: '5',
    dummyTransactionsPerBallot: '1',
    electionPopulation: '100'
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
        walletAddress: linkedWalletAddress,
        protocolVersion: formData.protocolVersion,
        ...(paddedProtocols.includes(formData.protocolVersion) ? {
          paddingConfig: {
            paddingRatePercent: Number(formData.paddingRatePercent),
            selectionStrategy: formData.selectionStrategy,
            timingDistribution: formData.timingDistribution,
            timingWindowSeconds: Number(formData.timingWindowSeconds),
            dummyTransactionsPerBallot: Number(formData.dummyTransactionsPerBallot),
            electionPopulation: Number(formData.electionPopulation)
          }
        } : {})
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
            <label className="block font-semibold mb-2 text-gray-700">Voting protocol</label>
            <select
              name="protocolVersion"
              value={formData.protocolVersion}
              onChange={handleFieldChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-600"
            >
              <option value="c0-encrypted">C0 encrypted baseline</option>
              <option value="c1p-revoting-padding">C1p revoting + activity padding</option>
              <option value="c2-private-decoy">C2 panic/decoy credentials</option>
              <option value="c2p-private-decoy-padding">C2p panic/decoy + activity padding</option>
              <option value="c3-revoting-decoy">C3 revoting + panic/decoy credentials</option>
            </select>
            <p className="text-sm text-gray-500 mt-2">
              C2/C2p/C3 use private genuine and decoy credentials. Voters use their registration-time decoy password; those ballots are excluded during trusted finalization. C1p adds revoting; C1p/C2p add configurable padding. These are experimental mechanisms, not formal coercion resistance.
            </p>
          </div>
          {paddedProtocols.includes(formData.protocolVersion) && (
            <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-semibold text-amber-950">Padding experiment controls</h3>
              <p className="mt-1 text-sm text-amber-900">
                Padding uses additional registry transactions signed by the voter wallet. C1p/C2p require on-chain receipt anchoring and the registry contract to be deployed. Choose a population sample or independently pad each ballot. The population sample selects a fraction of voters without replacement; per-ballot mode independently samples each ballot. Selected activity emits the configured number of padding receipts.
              </p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="text-sm font-medium text-gray-700">
                  Padding rate ({formData.selectionStrategy === 'population-sample' ? '% of population' : '% per ballot'})
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    name="paddingRatePercent"
                    value={formData.paddingRatePercent}
                    onChange={handleFieldChange}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Declared election population
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    step="1"
                    name="electionPopulation"
                    value={formData.electionPopulation}
                    onChange={handleFieldChange}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Padding selection strategy
                  <select
                    name="selectionStrategy"
                    value={formData.selectionStrategy}
                    onChange={handleFieldChange}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  >
                    <option value="population-sample">Sample voters without replacement</option>
                    <option value="per-ballot">Independent per-ballot sampling</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Dummy transactions per accepted ballot
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="1"
                    name="dummyTransactionsPerBallot"
                    value={formData.dummyTransactionsPerBallot}
                    onChange={handleFieldChange}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Timing distribution
                  <select
                    name="timingDistribution"
                    value={formData.timingDistribution}
                    onChange={handleFieldChange}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  >
                    <option value="immediate">Immediate</option>
                    <option value="fixed">Evenly spaced (fixed)</option>
                    <option value="uniform">Uniform over window</option>
                    <option value="exponential">Exponential gaps</option>
                  </select>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Timing window (seconds, max 60)
                  <input
                    type="number"
                    min="0"
                    max="60"
                    step="1"
                    name="timingWindowSeconds"
                    value={formData.timingWindowSeconds}
                    onChange={handleFieldChange}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
              </div>
            </div>
          )}
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
