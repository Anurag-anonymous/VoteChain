import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiCheckSquare, FiLogOut, FiMenu, FiX } from 'react-icons/fi';
import { useAuthStore } from '../store/authStore';

const Navbar = () => {
  const { isAuthenticated, user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  const closeMenu = () => setIsOpen(false);

  const handleLogout = () => {
    logout();
    closeMenu();
    navigate('/');
  };

  const navLinkClass = 'text-gray-700 hover:text-indigo-600 transition font-medium';

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <Link to="/" onClick={closeMenu} className="flex items-center space-x-2 font-bold text-xl text-indigo-600">
            <FiCheckSquare className="text-2xl" />
            <span>VoteChain</span>
          </Link>

          <div className="hidden md:flex items-center space-x-6">
            <Link to="/polls" className={navLinkClass}>Polls</Link>
            <Link to="/discussions" className={navLinkClass}>Discussions</Link>

            {isAuthenticated ? (
              <>
                <Link to="/create-poll" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold">
                  Create Poll
                </Link>
                <Link to="/dashboard" className={navLinkClass}>Dashboard</Link>
                <Link to="/profile" className={navLinkClass}>{user?.firstName || 'Profile'}</Link>
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition font-semibold"
                >
                  <FiLogOut />
                  <span>Logout</span>
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className={navLinkClass}>Login</Link>
                <Link to="/register" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-semibold">
                  Register
                </Link>
              </>
            )}
          </div>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden text-gray-700 p-2"
            aria-label="Toggle navigation menu"
          >
            {isOpen ? <FiX size={24} /> : <FiMenu size={24} />}
          </button>
        </div>

        {isOpen && (
          <div className="md:hidden pb-4 space-y-2">
            <Link onClick={closeMenu} to="/polls" className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Polls</Link>
            <Link onClick={closeMenu} to="/discussions" className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Discussions</Link>

            {isAuthenticated ? (
              <>
                <Link onClick={closeMenu} to="/create-poll" className="block px-4 py-2 bg-indigo-600 text-white rounded">Create Poll</Link>
                <Link onClick={closeMenu} to="/dashboard" className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Dashboard</Link>
                <Link onClick={closeMenu} to="/profile" className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Profile</Link>
                <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 rounded">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link onClick={closeMenu} to="/login" className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">Login</Link>
                <Link onClick={closeMenu} to="/register" className="block px-4 py-2 bg-indigo-600 text-white rounded">Register</Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
