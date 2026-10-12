import React, { useState } from "react";
import { loginAdmin, signupAdmin, forgotPassword, resetPassword } from "../api";
import { MaterialIcon } from "../components/ui/MaterialIcon";

export const AuthPage = ({ onLoginSuccess }) => {
  const [view, setView] = useState("login"); // login, signup, forgot, reset
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");

  const clearMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    clearMessages();
    try {
      const data = await loginAdmin(email, password);
      const jwtToken = data.token || data.accessToken;
      if (!jwtToken) throw new Error("No authentication token received");
      
      localStorage.setItem("admin_jwt_token", jwtToken);
      localStorage.setItem("admin_user_data", JSON.stringify(data));
      onLoginSuccess(data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Invalid credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const data = await signupAdmin(name, phone, email, password, confirmPassword);
      const jwtToken = data.token || data.accessToken;
      if (!jwtToken) throw new Error("No authentication token received");
      localStorage.setItem("admin_jwt_token", jwtToken);
      localStorage.setItem("admin_user_data", JSON.stringify(data));
      onLoginSuccess(data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to sign up.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    clearMessages();
    try {
      const msg = await forgotPassword(email);
      setSuccessMsg("If an account exists, a reset link has been sent.");
      setView("reset"); // Go to reset view to enter token
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    clearMessages();
    try {
      await resetPassword(token, password);
      setSuccessMsg("Password reset successfully! Please login.");
      setView("login");
      setPassword("");
      setToken("");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Reset failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0d10] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#111418] rounded-none border border-white/10 shadow-none p-8 sm:p-10 space-y-8">
        {/* Brand & Heading */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-none bg-white text-black flex items-center justify-center mx-auto shadow-none">
            <MaterialIcon name="print" size={28} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-100 tracking-tight">
            PrintAlfa Desktop
          </h1>
          <p className="text-sm text-zinc-400">
            {view === "login" && "Sign in to your shop"}
            {view === "signup" && "Create a new shop account"}
            {view === "forgot" && "Reset your password"}
            {view === "reset" && "Enter your reset token"}
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-none bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm font-semibold flex items-center gap-3">
            <MaterialIcon name="error" size={18} className="shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
        
        {successMsg && (
          <div className="p-4 rounded-none bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-semibold flex items-center gap-3">
            <MaterialIcon name="error" size={18} className="shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* LOGIN VIEW */}
        {view === "login" && (
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Email</label>
              <div className="relative">
                <MaterialIcon name="mail" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="input-field input-with-icon"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Password</label>
              <div className="relative">
                <MaterialIcon name="lock" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field input-with-icon"
                />
              </div>
            </div>
            
            <div className="flex justify-between items-center text-sm">
              <button type="button" onClick={() => setView("signup")} className="text-zinc-100 font-semibold hover:underline cursor-pointer">
                Create Account
              </button>
              <button type="button" onClick={() => setView("forgot")} className="text-zinc-100 font-semibold hover:underline cursor-pointer">
                Forgot Password?
              </button>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full h-12 rounded-none font-bold flex items-center justify-center gap-2 cursor-pointer">
              {loading ? <MaterialIcon name="progress_activity" size={18} className="animate-spin" /> : <><span>Sign In</span><MaterialIcon name="arrow_forward" size={18} /></>}
            </button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-white/10"></div>
              <span className="flex-shrink mx-4 text-xs font-bold text-zinc-400 uppercase tracking-wider">or</span>
              <div className="flex-grow border-t border-white/10"></div>
            </div>

            <button
              type="button"
              disabled
              title="Not configured"
              aria-disabled="true"
              className="w-full h-12 rounded-none border border-white/10 bg-[#111418] text-zinc-500 font-bold flex items-center justify-center gap-3 transition-colors opacity-50 cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Continue with Google</span>
            </button>
          </form>
        )}

        {/* SIGNUP VIEW */}
        {view === "signup" && (
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Full Name</label>
              <div className="relative">
                <MaterialIcon name="person" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="input-field input-with-icon" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Phone</label>
              <div className="relative">
                <MaterialIcon name="call" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input type="text" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="1234567890" className="input-field input-with-icon" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Email</label>
              <div className="relative">
                <MaterialIcon name="mail" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" className="input-field input-with-icon" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Password</label>
              <div className="relative">
                <MaterialIcon name="lock" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input-field input-with-icon" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Confirm Password</label>
              <div className="relative">
                <MaterialIcon name="lock" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className="input-field input-with-icon" />
              </div>
            </div>
            
            <div className="text-sm text-center">
              <button type="button" onClick={() => setView("login")} className="text-zinc-100 font-semibold hover:underline cursor-pointer">
                Already have an account? Login
              </button>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full h-12 rounded-none font-bold flex items-center justify-center gap-2 cursor-pointer">
              {loading ? <MaterialIcon name="progress_activity" size={18} className="animate-spin" /> : <><span>Sign Up</span><MaterialIcon name="arrow_forward" size={18} /></>}
            </button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-white/10"></div>
              <span className="flex-shrink mx-4 text-xs font-bold text-zinc-400 uppercase tracking-wider">or</span>
              <div className="flex-grow border-t border-white/10"></div>
            </div>

            <button
              type="button"
              disabled
              title="Not configured"
              aria-disabled="true"
              className="w-full h-12 rounded-none border border-white/10 bg-[#111418] text-zinc-500 font-bold flex items-center justify-center gap-3 transition-colors opacity-50 cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Sign Up with Google</span>
            </button>
          </form>
        )}

        {/* FORGOT PASSWORD VIEW */}
        {view === "forgot" && (
          <form onSubmit={handleForgotPassword} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Email</label>
              <div className="relative">
                <MaterialIcon name="mail" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="input-field input-with-icon"
                />
              </div>
            </div>
            
            <div className="text-sm text-center flex justify-between">
              <button type="button" onClick={() => setView("login")} className="text-zinc-100 font-semibold hover:underline cursor-pointer">
                Back to Login
              </button>
              <button type="button" onClick={() => setView("reset")} className="text-zinc-100 font-semibold hover:underline cursor-pointer">
                Have a token?
              </button>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full h-12 rounded-none font-bold flex items-center justify-center gap-2 cursor-pointer">
              {loading ? <MaterialIcon name="progress_activity" size={18} className="animate-spin" /> : <><span>Send Reset Link</span><MaterialIcon name="arrow_forward" size={18} /></>}
            </button>
          </form>
        )}

        {/* RESET PASSWORD VIEW */}
        {view === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Reset Token</label>
              <div className="relative">
                <MaterialIcon name="lock" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste token here"
                  className="input-field input-with-icon"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider">New Password</label>
              <div className="relative">
                <MaterialIcon name="lock" size={18} className="text-zinc-500 pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field input-with-icon"
                />
              </div>
            </div>
            
            <div className="text-sm text-center">
              <button type="button" onClick={() => setView("login")} className="text-zinc-100 font-semibold hover:underline cursor-pointer">
                Back to Login
              </button>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full h-12 rounded-none font-bold flex items-center justify-center gap-2 cursor-pointer">
              {loading ? <MaterialIcon name="progress_activity" size={18} className="animate-spin" /> : <><span>Reset Password</span><MaterialIcon name="arrow_forward" size={18} /></>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
