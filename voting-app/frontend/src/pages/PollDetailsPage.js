import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { pollService } from '../services';
import { useAuthStore } from '../store/authStore';

const formatDate = (dateString) => {
  if (!dateString) return 'Unknown';
  return new Date(dateString).toLocaleString();
};

const PollDetailsPage = () => {
  const { id } = useParams();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [poll, setPoll] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadPoll = useCallback(async () => {
    const [pollResponse, resultsResponse] = await Promise.all([
      pollService.getPoll(id),
      pollService.getPollResults(id)
    ]);
    setPoll(pollResponse.data.poll);
    setResults(resultsResponse.data.results);
  }, [id]);

  useEffect(() => {
    loadPoll()
      .catch((error) => {
        toast.error(error.response?.data?.message || 'Unable to load poll');
      })
      .finally(() => setLoading(false));
  }, [loadPoll]);

  const handleFinalize = async () => {
    try {
      setBusy(true);
      await pollService.finalizeTally(id);
      toast.success('Tally finalized');
      await loadPoll();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to finalize tally');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-gray-600">Loading poll...</p>;
  }

  if (!poll) {
    return <p className="text-gray-600">Poll not found.</p>;
  }

  const creatorId = poll.creator?._id || poll.creator;
  const isCreator = isAuthenticated && user?.id && creatorId === user.id;
  const canFinalize = isCreator && poll.protocolVersion === 'c0-mock-encrypted' && poll.tallyState !== 'finalized';
  const resultOptions = results?.options || poll.options || [];

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{poll.title}</h1>
            <p className="text-gray-600 mt-2">{poll.description}</p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
            {poll.protocolVersion === 'c0-mock-encrypted' ? 'C0 encrypted baseline' : 'Legacy'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 mb-6">
          <div>
            <p className="font-semibold text-gray-800">Status</p>
            <p>{poll.status}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-800">Accepted Ballots</p>
            <p>{poll.publicBallotCount || poll.totalVotes || 0}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-800">Ends</p>
            <p>{formatDate(poll.endDate)}</p>
          </div>
        </div>

        <div className="space-y-3">
          {resultOptions.map((option) => (
            <div key={option._id || option.optionId} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="font-semibold text-gray-800">{option.optionText}</p>
                <p className="text-sm text-gray-600">
                  {option.hidden || poll.tallyHidden
                    ? 'Hidden until finalization'
                    : `${option.votes} votes (${option.percentage}%)`}
                </p>
              </div>
            </div>
          ))}
        </div>

        {canFinalize && (
          <button
            type="button"
            onClick={handleFinalize}
            disabled={busy}
            className="mt-6 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Finalizing...' : 'Finalize Tally'}
          </button>
        )}

        {poll.tallyHidden && (
          <p className="mt-4 text-sm text-gray-500">
            Candidate totals are intentionally hidden while this election is open.
          </p>
        )}
      </div>
    </div>
  );
};

export default PollDetailsPage;
