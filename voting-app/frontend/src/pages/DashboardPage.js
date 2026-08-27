import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const DashboardPage = () => {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      {/* Stats Cards */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <p className="text-gray-600 text-sm mb-2">Total Polls Created</p>
        <p className="text-3xl font-bold text-indigo-600">0</p>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <p className="text-gray-600 text-sm mb-2">Total Votes Cast</p>
        <p className="text-3xl font-bold text-green-600">0</p>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <p className="text-gray-600 text-sm mb-2">Active Polls</p>
        <p className="text-3xl font-bold text-blue-600">0</p>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-md">
        <p className="text-gray-600 text-sm mb-2">Discussions</p>
        <p className="text-3xl font-bold text-purple-600">0</p>
      </div>

      {/* Welcome Message */}
      <div className="md:col-span-4 bg-gradient-to-r from-indigo-500 to-blue-500 p-8 rounded-lg text-white">
        <h2 className="text-3xl font-bold mb-2">Welcome, {user?.firstName}!</h2>
        <p className="mb-4">You are verified and ready to participate in the democratic process through secure blockchain voting.</p>
        <a href="/create-poll" className="inline-block px-6 py-2 bg-white text-indigo-600 rounded-lg font-bold hover:bg-gray-100 transition">
          Create Your First Poll
        </a>
      </div>
    </div>
  );
};

export default DashboardPage;
