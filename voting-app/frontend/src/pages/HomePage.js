import React from 'react';
import { Link } from 'react-router-dom';

const HomePage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
          Secure Voting on <span className="text-indigo-600">Blockchain</span>
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Experience transparent, secure, and tamper-proof voting with blockchain technology. 
          Built with Aadhar verification to ensure fraud-free elections.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link to="/register" className="px-8 py-4 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition">
            Get Started
          </Link>
          <Link to="/polls" className="px-8 py-4 border-2 border-indigo-600 text-indigo-600 rounded-lg font-bold hover:bg-indigo-50 transition">
            View Polls
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-4xl font-bold text-center mb-12">Key Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Feature 1 */}
          <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-lg transition">
            <div className="text-4xl mb-4">🔒</div>
            <h3 className="text-xl font-bold mb-2">Aadhar Verified</h3>
            <p className="text-gray-600">
              Every voter is verified using Aadhar card number with OTP authentication to prevent duplicate voting.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-lg transition">
            <div className="text-4xl mb-4">⛓️</div>
            <h3 className="text-xl font-bold mb-2">Blockchain Secure</h3>
            <p className="text-gray-600">
              All votes are recorded on Polygon blockchain, making them immutable and transparent for verification.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-lg transition">
            <div className="text-4xl mb-4">💬</div>
            <h3 className="text-xl font-bold mb-2">Community Discussion</h3>
            <p className="text-gray-600">
              Engage in thoughtful discussions with community members to share opinions and insights.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-lg transition">
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-xl font-bold mb-2">Real-time Results</h3>
            <p className="text-gray-600">
              View real-time poll results and statistics instantly as votes are cast on the blockchain.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-lg transition">
            <div className="text-4xl mb-4">🔓</div>
            <h3 className="text-xl font-bold mb-2">Transparent</h3>
            <p className="text-gray-600">
              Complete transparency with blockchain verification. Every vote is verifiable and cannot be tampered with.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="bg-white p-8 rounded-lg shadow-md hover:shadow-lg transition">
            <div className="text-4xl mb-4">🚀</div>
            <h3 className="text-xl font-bold mb-2">Easy to Use</h3>
            <p className="text-gray-600">
              User-friendly interface with simple registration and voting process. Get started in minutes.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-5xl font-bold text-indigo-600 mb-4">1</div>
              <h3 className="font-bold mb-2">Register</h3>
              <p className="text-gray-600">Create account with Aadhar verification and OTP confirmation</p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-indigo-600 mb-4">2</div>
              <h3 className="font-bold mb-2">Connect Wallet</h3>
              <p className="text-gray-600">Link your Polygon wallet to participate in voting</p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-indigo-600 mb-4">3</div>
              <h3 className="font-bold mb-2">Vote</h3>
              <p className="text-gray-600">Cast your vote on polls and view instant results</p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-indigo-600 mb-4">4</div>
              <h3 className="font-bold mb-2">Verify</h3>
              <p className="text-gray-600">Verify vote on blockchain anytime, anywhere</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-4xl font-bold mb-8">Ready to Vote?</h2>
        <p className="text-xl text-gray-600 mb-8">Join thousands of voters and make your voice heard on the blockchain.</p>
        <Link to="/register" className="px-8 py-4 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition">
          Start Voting Now
        </Link>
      </section>
    </div>
  );
};

export default HomePage;
