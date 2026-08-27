import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-gray-300 py-12 mt-16">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* About */}
          <div>
            <h3 className="text-white font-bold mb-4">VoteChain</h3>
            <p className="text-sm">
              Secure, transparent, and decentralized voting platform built on blockchain technology.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-bold mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/polls" className="hover:text-white transition">Polls</Link></li>
              <li><Link to="/discussions" className="hover:text-white transition">Discussions</Link></li>
              <li><Link to="/" className="hover:text-white transition">How it works</Link></li>
              <li><Link to="/" className="hover:text-white transition">Security</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-white font-bold mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-white transition">Documentation</Link></li>
              <li><Link to="/" className="hover:text-white transition">FAQ</Link></li>
              <li><Link to="/" className="hover:text-white transition">Contact</Link></li>
              <li><Link to="/" className="hover:text-white transition">Support</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-white font-bold mb-4">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-white transition">Privacy Policy</Link></li>
              <li><Link to="/" className="hover:text-white transition">Terms of Service</Link></li>
              <li><Link to="/" className="hover:text-white transition">Cookie Policy</Link></li>
              <li><Link to="/" className="hover:text-white transition">Disclaimer</Link></li>
            </ul>
          </div>
        </div>

        <hr className="border-gray-700 my-8" />

        <div className="flex flex-col md:flex-row justify-between items-center text-sm">
          <p>&copy; 2024 VoteChain. All rights reserved.</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="https://twitter.com" className="hover:text-white transition">Twitter</a>
            <a href="https://github.com" className="hover:text-white transition">GitHub</a>
            <a href="https://linkedin.com" className="hover:text-white transition">LinkedIn</a>
            <a href="https://discord.com" className="hover:text-white transition">Discord</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
