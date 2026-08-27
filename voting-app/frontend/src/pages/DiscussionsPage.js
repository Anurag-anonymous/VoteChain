import React from 'react';

const DiscussionsPage = () => {
  return (
    <div className="py-8">
      <h1 className="text-4xl font-bold mb-8">Community Discussions</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <p className="text-gray-600 text-center py-12">No discussions yet. Start one!</p>
        </div>
      </div>
    </div>
  );
};

export default DiscussionsPage;
