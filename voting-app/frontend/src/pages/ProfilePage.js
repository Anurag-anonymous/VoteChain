import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const ProfilePage = () => {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">My Profile</h1>
      <div className="bg-white p-8 rounded-lg shadow-md">
        <div className="space-y-4">
          <div>
            <p className="text-gray-600">Name</p>
            <p className="text-xl font-bold">{user?.firstName} {user?.lastName}</p>
          </div>
          <div>
            <p className="text-gray-600">Email</p>
            <p className="text-xl font-bold">{user?.email}</p>
          </div>
          <div>
            <p className="text-gray-600">Profile form and more details will be displayed here</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
