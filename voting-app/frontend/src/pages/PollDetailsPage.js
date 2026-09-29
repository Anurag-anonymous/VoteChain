import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { pollService } from '../services';
import { useAuthStore } from '../store/authStore';

const formatDate = (dateString) => {
  if (!dateString) return 'Unknown';
  return new Date(dateString).toLocaleString();
};

const isEncryptedProtocol = (protocolVersion) => (
  [
    'c0-encrypted',
    'c1p-revoting-padding',
    'c2-private-decoy',
    'c2p-private-decoy-padding',
    'c3-revoting-decoy',
    'c0-mock-encrypted'
  ].includes(protocolVersion)
);

const getProtocolLabel = (poll) => {
  if (!isEncryptedProtocol(poll.protocolVersion)) return 'Legacy';
  if (poll.protocolVersion === 'c1p-revoting-padding') return 'C1p revoting + padding';
  if (poll.protocolVersion === 'c2-private-decoy') return 'C2 panic/decoy';
  if (poll.protocolVersion === 'c2p-private-decoy-padding') return 'C2p decoy + padding';
  if (poll.protocolVersion === 'c3-revoting-decoy') return 'C3 revoting + panic/decoy';
  return poll.revotingEnabled ? 'C1 revoting' : 'C0 encrypted baseline';
};

const shortHash = (value) => {
  if (!value) return 'Not anchored';
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
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

  const handleDownloadObserverDataset = async () => {
    try {
      setBusy(true);
      const response = await pollService.getObserverDataset(id);
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `observer-dataset-${id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Observer experiment dataset downloaded');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Unable to export observer dataset');
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
  const canFinalize = isCreator && isEncryptedProtocol(poll.protocolVersion) && poll.tallyState !== 'finalized';
  const resultOptions = results?.options || poll.options || [];
  const receiptAnchors = poll.receiptAnchors || [];

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{poll.title}</h1>
            <p className="text-gray-600 mt-2">{poll.description}</p>
          </div>
          <span className="px-2.5 py-1.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 leading-none">
            {getProtocolLabel(poll)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600 mb-6">
          <div>
            <p className="font-semibold text-gray-800">Status</p>
            <p>{poll.status}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-800">Accepted Ballots</p>
            <p>{poll.publicBallotCount || poll.totalVotes || 0}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-800">Tally</p>
            <p>{poll.tallyState === 'finalized' ? 'Finalized' : 'Hidden'}</p>
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

        {isCreator && ['c1p-revoting-padding', 'c2p-private-decoy-padding'].includes(poll.protocolVersion) && (
          <div className="mt-4">
            <button
              type="button"
              onClick={handleDownloadObserverDataset}
              disabled={busy}
              className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              {busy ? 'Preparing...' : 'Download observer experiment dataset'}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              This export joins private ground-truth labels to public chain metadata. Never share it with the observer; keep it restricted to the experiment analyst.
            </p>
          </div>
        )}

        {poll.tallyHidden && (
          <p className="mt-4 text-sm text-gray-500">
            Candidate totals are intentionally hidden while this election is open.
          </p>
        )}
        {['c2-private-decoy', 'c2p-private-decoy-padding', 'c3-revoting-decoy'].includes(poll.protocolVersion) ? (
          <p className="mt-4 text-sm text-gray-500">
            This research poll supports alternate sign-in credentials and trusted tally cleansing. C2p adds configurable padding. Neither mechanism is formal JCJ coercion resistance.
          </p>
        ) : null}
        {['c1p-revoting-padding', 'c2p-private-decoy-padding'].includes(poll.protocolVersion) && (
          <p className="mt-2 text-sm text-gray-500">
            Padding adds same-method encrypted receipt transactions; settings and activity labels are private to the experiment backend.
          </p>
        )}
        {poll.tallyState === 'finalized' && poll.excludedPanicBallotCount > 0 && (
          <p className="mt-2 text-sm text-gray-500">
            {poll.excludedPanicBallotCount} ballot(s) were excluded during private credential cleansing.
          </p>
        )}

        {receiptAnchors.length > 0 && (
          <div className="mt-6 border-t border-gray-200 pt-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-semibold text-gray-900">C1 Receipt Anchors</h2>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                {receiptAnchors.length} on-chain
              </span>
            </div>

            <div className="space-y-3">
              {receiptAnchors.slice(0, 5).map((receipt) => (
                <div key={receipt.ballotId} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1">
                    <p className="font-semibold text-gray-800">{shortHash(receipt.transactionHash)}</p>
                    <p className="text-gray-500">Block {receipt.blockNumber || 'pending'}</p>
                  </div>
                  <p className="text-gray-500 mt-1">Registry {shortHash(receipt.to)}</p>
                  {receipt.hashes?.nullifierHash && (
                    <p className="text-gray-500 mt-1">Nullifier hash {shortHash(receipt.hashes.nullifierHash)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PollDetailsPage;
