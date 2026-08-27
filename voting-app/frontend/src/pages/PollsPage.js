import React from 'react';

const PollsPage = () => {
  return (
    <div className="py-8">
      <h1 className="text-4xl font-bold mb-8">Active Polls</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Placeholder for polls */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <p className="text-gray-600 text-center py-12">No polls found. Check back soon!</p>
        </div>
      </div>
    </div>
  );
};

export default PollsPage;
