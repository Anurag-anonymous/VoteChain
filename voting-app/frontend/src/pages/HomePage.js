import React from 'react';
import { Link } from 'react-router-dom';
import { FiBarChart2, FiCheckCircle, FiLock, FiMessageSquare, FiShield, FiUsers } from 'react-icons/fi';

const features = [
  {
    icon: FiShield,
    title: 'Aadhaar OTP Verification',
    text: 'Register with Aadhaar and confirm identity through OTP before participating.'
  },
  {
    icon: FiLock,
    title: 'Blockchain Voting',
    text: 'Votes are prepared for immutable recording with wallet-based verification.'
  },
  {
    icon: FiBarChart2,
    title: 'Live Results',
    text: 'Poll totals and participation metrics are visible as voters take action.'
  },
  {
    icon: FiMessageSquare,
    title: 'Discussions',
    text: 'Keep debate and context close to the polls people are voting on.'
  },
  {
    icon: FiUsers,
    title: 'One Person, One Account',
    text: 'Aadhaar uniqueness checks reduce duplicate registrations.'
  },
  {
    icon: FiCheckCircle,
    title: 'Simple Workflow',
    text: 'Register, verify, connect a wallet, create or vote in polls.'
  }
];

const HomePage = () => {
  return (
    <div className="min-h-screen">
      <section className="rounded-2xl bg-slate-950 text-white px-6 py-14 md:px-10 md:py-16 overflow-hidden">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300 mb-4">
              Secure digital polling
            </p>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
              VoteChain
            </h1>
            <p className="text-lg md:text-xl text-slate-200 max-w-2xl mb-8">
              A blockchain voting platform with Aadhaar OTP verification, poll creation,
              transparent results, and community discussion in one place.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link to="/register" className="px-6 py-3 bg-cyan-400 text-slate-950 rounded-lg font-bold hover:bg-cyan-300 transition text-center">
                Register and Verify
              </Link>
              <Link to="/polls" className="px-6 py-3 border border-slate-500 text-white rounded-lg font-bold hover:bg-white hover:text-slate-950 transition text-center">
                View Polls
              </Link>
            </div>
          </div>

          <div className="bg-white/10 border border-white/15 rounded-xl p-5">
            <h2 className="font-bold text-xl mb-4">Workflow</h2>
            <div className="space-y-4">
              {['Create account', 'Verify Aadhaar OTP', 'Connect wallet', 'Vote or create polls'].map((item, index) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400 text-slate-950 font-bold">
                    {index + 1}
                  </span>
                  <span className="text-slate-100">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600 mb-2">Features</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Everything visible at a glance</h2>
          </div>
          <Link to="/discussions" className="text-indigo-600 font-semibold hover:text-indigo-700">
            Open discussions
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <div className="h-11 w-11 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                <Icon size={22} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
              <p className="text-gray-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 mb-12">
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <p className="text-3xl font-bold text-indigo-600">01</p>
            <h3 className="font-bold mt-2 mb-1">Verify</h3>
            <p className="text-gray-600">Confirm Aadhaar OTP before accessing protected voting actions.</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-cyan-600">02</p>
            <h3 className="font-bold mt-2 mb-1">Participate</h3>
            <p className="text-gray-600">Browse active polls, vote, or create a poll for others.</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-emerald-600">03</p>
            <h3 className="font-bold mt-2 mb-1">Review</h3>
            <p className="text-gray-600">Track results and continue the conversation in discussions.</p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
