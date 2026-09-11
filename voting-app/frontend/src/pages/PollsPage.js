import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { pollService } from '../services';
import { useAuthStore } from '../store/authStore';

const formatDate = (dateString) => {
  if (!dateString) return 'No end date';

  return new Date(dateString).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const getCreatorName = (creator) => {
  if (!creator) return 'Unknown user';

  const firstName = creator.firstName || '';
  const lastName = creator.lastName || '';

  return `${firstName} ${lastName}`.trim() || 'Unknown user';
};

const getInitials = (creator) => {
  if (!creator) return 'U';

  const firstName = creator.firstName || '';
  const lastName = creator.lastName || '';

  return `${firstName.charAt(0) || ''}${lastName.charAt(0) || ''}`.toUpperCase() || 'U';
};

const PollsPage = () => {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [votingPollId, setVotingPollId] = useState(null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  const loadPolls = async () => {
    try {
      const response = await pollService.getAllPolls({ limit: 20 });
      setPolls(response.data?.polls || []);
    } catch (error) {
      console.error('Failed to load polls:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolls();
  }, []);

  const handleVote = async (pollId, optionId) => {
    if (!isAuthenticated) {
      toast.error('Please log in to vote');
      return;
    }

    if (!user?.walletAddress) {
      toast.error('Please link your wallet before voting');
      return;
    }

    try {
      setVotingPollId(pollId);
      await pollService.vote(pollId, {
        optionId,
        walletAddress: user.walletAddress
      });

      toast.success('Vote recorded successfully');
      await loadPolls();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to vote right now');
    } finally {
      setVotingPollId(null);
    }
  };

  if (loading) {
    return (
      <div className="py-8">
        <h1 className="text-4xl font-bold mb-8">Active Polls</h1>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <p className="text-gray-600 text-center py-12">Loading polls...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-4xl font-bold">Active Polls</h1>
        <Link
          to="/create-poll"
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
        >
          Create Poll
        </Link>
      </div>

      {polls.length === 0 ? (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <p className="text-gray-600 text-center py-12">No polls found. Create the first poll to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {polls.map((poll) => {
            const creatorName = getCreatorName(poll.creator);
            const isVoting = votingPollId === poll._id;

            return (
              <article
                key={poll._id}
                className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-xl transition duration-200"
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                      {poll.creator?.profileImage ? (
                        <img
                          src={poll.creator.profileImage}
                          alt={creatorName}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        getInitials(poll.creator)
                      )}
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Posted by</p>
                      <p className="font-semibold text-gray-800">{creatorName}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">
                      {poll.category || 'other'}
                    </span>
                    <p className="text-xs text-gray-500 mt-2">{poll.status || 'active'}</p>
                  </div>
                </div>

                <h2 className="text-2xl font-bold mb-2 text-gray-900">{poll.title}</h2>
                <p className="text-gray-600 mb-4">{poll.description}</p>

                <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                  <span>{poll.totalVotes || 0} votes</span>
                  <span>Ends {formatDate(poll.endDate)}</span>
                </div>

                <div className="space-y-2 mb-4">
                  {poll.options?.map((option) => (
                    <button
                      key={option._id}
                      type="button"
                      onClick={() => handleVote(poll._id, option._id)}
                      disabled={isVoting}
                      className={`w-full flex items-center justify-between px-3 py-2.5 border rounded-xl transition ${
                        isVoting
                          ? 'border-indigo-200 bg-indigo-50 cursor-wait'
                          : 'border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50'
                      }`}
                    >
                      <span className="text-left text-sm font-medium text-gray-700">{option.optionText}</span>
                      <span className="text-xs font-semibold text-gray-500">{option.votes || 0}</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                  <span className="text-xs text-gray-500">{poll.totalParticipants || 0} participants</span>
                  <Link
                    to={`/polls/${poll._id}`}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    View details
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PollsPage;
