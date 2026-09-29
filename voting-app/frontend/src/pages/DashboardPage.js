import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { pollService } from '../services';
import { useAuthStore } from '../store/authStore';

const DashboardPage = () => {
  const { isAuthenticated, user } = useAuthStore();
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    pollService.getMyPolls()
      .then((response) => setPolls(response.data?.polls || []))
      .catch((error) => toast.error(error.response?.data?.message || 'Unable to load your polls'))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const activePolls = useMemo(() => polls.filter((poll) => poll.status === 'active'), [polls]);

  const handleDelete = async (pollId) => {
    if (!window.confirm('Delete this poll card permanently?')) return;
    try {
      await pollService.deletePoll(pollId);
      setPolls((current) => current.filter((poll) => poll._id !== pollId));
      toast.success('Poll deleted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to delete poll');
    }
  };

  if (!isAuthenticated) return <Navigate to="/login" />;

  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-r from-indigo-500 to-blue-500 p-8 rounded-lg text-white">
        <h2 className="text-3xl font-bold mb-2">Welcome, {user?.firstName}!</h2>
        <p className="mb-4">Manage your active and completed polls here.</p>
        <Link to="/create-poll" className="inline-block px-6 py-2 bg-white text-indigo-600 rounded-lg font-bold hover:bg-gray-100">
          Create Poll
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md"><p className="text-gray-600 text-sm">Total Polls</p><p className="text-3xl font-bold text-indigo-600">{polls.length}</p></div>
        <div className="bg-white p-6 rounded-lg shadow-md"><p className="text-gray-600 text-sm">Active Polls</p><p className="text-3xl font-bold text-blue-600">{activePolls.length}</p></div>
        <div className="bg-white p-6 rounded-lg shadow-md"><p className="text-gray-600 text-sm">Completed Polls</p><p className="text-3xl font-bold text-green-600">{polls.length - activePolls.length}</p></div>
      </div>

      <section>
        <h2 className="text-2xl font-bold mb-4">Your Polls</h2>
        {loading ? <p className="text-gray-600">Loading polls...</p> : polls.length === 0 ? (
          <div className="bg-white p-6 rounded-lg shadow-md text-gray-600">You have not created any polls yet.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {polls.map((poll) => (
              <article key={poll._id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold">{poll.title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{poll.status} · {poll.tallyState === 'finalized' ? 'tally finalized' : 'tally pending'}</p>
                  </div>
                  <span className="text-xs font-semibold text-indigo-700 bg-indigo-100 px-2.5 py-1.5 rounded-full leading-none">
                    {poll.revotingEnabled ? 'C1 revoting' : 'C0 baseline'}
                  </span>
                </div>
                <p className="text-gray-600 mt-3">{poll.description}</p>
                <div className="flex justify-between items-center mt-5">
                  <Link to={`/polls/${poll._id}`} className="text-indigo-600 font-semibold">View poll</Link>
                  <button type="button" onClick={() => handleDelete(poll._id)} className="text-red-600 font-semibold hover:text-red-800">Delete card</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default DashboardPage;
