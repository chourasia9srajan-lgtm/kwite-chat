import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { Send, User, ShieldCheck, Clock, CheckCircle, Reply, Check, CheckCheck, LogOut, MessageSquare, UserPlus, Lock } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDiZJ8_L_qCUYdsTnDNRwOrofuVkWUbml4",
  authDomain: "kwite-e2c9a.firebaseapp.com",
  projectId: "kwite-e2c9a",
  storageBucket: "kwite-e2c9a.firebasestorage.app",
  messagingSenderId: "297509206721",
  appId: "1:297509206721:web:a7e386af3542f0a3f37240"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'kwite-chat-v1';

/**
 * NOTE: Firebase Auth strictly requires an email-like string.
 * We internally append a dummy domain to the username so the user 
 * only has to deal with their simple ID (e.g., "john").
 */
const toInternalId = (username) => `${username.toLowerCase().trim()}@internal.chat`;

export default function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [targetUsername, setTargetUsername] = useState(null); 
  const [targetUserProfile, setTargetUserProfile] = useState(null);
  const [view, setView] = useState('loading'); 
  const [availableUsers, setAvailableUsers] = useState([]);
  
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState(''); 
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const scrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // --- Helpers ---

  const getStatus = (profile) => {
    if (!profile?.lastSeen) return { label: "Offline", color: "bg-slate-300", isTyping: false };
    if (profile.typingTo === userProfile?.username?.toLowerCase()) {
        return { label: "Typing...", color: "bg-green-500", isTyping: true };
    }
    const date = profile.lastSeen.toDate ? profile.lastSeen.toDate() : new Date(profile.lastSeen);
    const diff = (new Date() - date) / 1000 / 60; 
    if (diff < 3) return { label: "Active Now", color: "bg-green-500", isTyping: false };
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isToday = date.toDateString() === new Date().toDateString();
    return { label: isToday ? `Last seen at ${timeStr}` : `Last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`, color: "bg-slate-300", isTyping: false };
  };

  const formatMessageTime = (timestamp) => {
    if (!timestamp) return "sending...";
    const date = timestamp.toDate();
    const now = new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) return timeStr;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  };

  // --- Keyboard Listeners ---

  useEffect(() => {
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        setTargetUsername(null);
        setTargetUserProfile(null);
        setReplyTo(null);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  // --- Presence & Typing Logic ---

  useEffect(() => {
    if (!userProfile) return;
    const myId = userProfile.username.toLowerCase();
    const myRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', myId);

    const updateStatus = async (isTyping = false) => {
      await updateDoc(myRef, { 
        lastSeen: serverTimestamp(),
        typingTo: isTyping ? targetUsername?.toLowerCase() || null : null
      }).catch(() => {});
    };

    if (newMessage.trim().length > 0 && targetUsername) {
        updateStatus(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => updateStatus(false), 3000);
    } else {
        updateStatus(false);
    }

    const presenceInterval = setInterval(() => updateStatus(newMessage.trim().length > 0), 120000);
    return () => {
        clearInterval(presenceInterval);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [userProfile, newMessage, targetUsername]);

  // --- Auth Management ---

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currUser) => {
      if (currUser) {
        setUser(currUser);
        const profileRef = doc(db, 'artifacts', appId, 'users', currUser.uid, 'profile', 'data');
        onSnapshot(profileRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserProfile(data);
            if (data.isAdmin || data.status === 'approved') {
              setView('chat');
              if (!data.isAdmin) fetchAdminData();
            } else {
              setView('pending');
            }
          } else {
            setView('login');
          }
        }, (err) => {
          setError("Database error. Please log in again.");
          signOut(auth);
        });
      } else {
        setUser(null);
        setView('login');
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchAdminData = () => {
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_users');
    onSnapshot(usersRef, (snapshot) => {
      const adminDoc = snapshot.docs.find(d => d.data().isAdmin === true);
      if (adminDoc) {
        setTargetUsername(adminDoc.id); 
        setTargetUserProfile(adminDoc.data());
      }
    });
  };

  // --- User List Updates ---

  useEffect(() => {
    if (userProfile && user) {
      const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_users');
      return onSnapshot(usersRef, (snapshot) => {
        const usersList = snapshot.docs.map(doc => ({ uidKey: doc.id, ...doc.data() }));
        if (userProfile.isAdmin) {
            setAvailableUsers(usersList.filter(u => u.uidKey !== userProfile.username.toLowerCase()));
        }
        if (targetUsername) {
            const updated = usersList.find(u => u.uidKey === targetUsername.toLowerCase());
            if (updated) setTargetUserProfile(updated);
        }
      });
    }
  }, [userProfile, user, targetUsername]);

  // --- Message Synchronization ---

  useEffect(() => {
    if (!user || !userProfile || !targetUsername || view !== 'chat') return;
    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const me = userProfile.username.toLowerCase();
      const them = targetUsername.toLowerCase();
      
      const filtered = msgs.filter(m => 
        (m.sender === me && m.receiver === them) ||
        (m.sender === them && m.receiver === me)
      );
      setMessages(filtered);

      const batch = writeBatch(db);
      let changes = false;
      snapshot.docs.forEach(d => {
        const m = d.data();
        if (m.receiver === me && m.sender === them && !m.read) {
          batch.update(d.ref, { read: true, readAt: serverTimestamp() });
          changes = true;
        }
      });
      if (changes) batch.commit().catch(() => {});
    });
    return () => unsubscribe();
  }, [user, userProfile, targetUsername, view]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Event Handlers ---

  const handleAuth = async (e) => {
    e.preventDefault();
    const cleanName = usernameInput.toLowerCase().trim();
    if (!cleanName || !passwordInput) return setError("Please enter your credentials.");
    if (passwordInput.length < 6) return setError("Password must be at least 6 characters.");
    
    setLoading(true);
    setError("");

    try {
      if (isRegistering) {
        // Sign up logic
        const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', cleanName);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          setLoading(false);
          return setError("This username is already taken.");
        }

        const isFirstAdmin = cleanName === 'admin';
        const cred = await createUserWithEmailAndPassword(auth, toInternalId(cleanName), passwordInput);
        
        const profileData = {
          username: usernameInput.trim(),
          status: isFirstAdmin ? 'approved' : 'pending',
          uid: cred.user.uid,
          isAdmin: isFirstAdmin, 
          lastSeen: serverTimestamp(),
          typingTo: null,
          createdAt: new Date().toISOString()
        };

        // Create the private profile and public record
        await setDoc(doc(db, 'artifacts', appId, 'users', cred.user.uid, 'profile', 'data'), profileData);
        await setDoc(userRef, profileData);
      } else {
        // Login logic
        await signInWithEmailAndPassword(auth, toInternalId(cleanName), passwordInput);
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setError("Invalid username or password.");
      } else if (err.code === 'auth/email-already-in-use') {
        setError("Account already exists for this username.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user || !userProfile || !targetUsername) return;
    const msgText = newMessage.trim();
    setNewMessage('');
    
    // Clear typing status
    const myRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', userProfile.username.toLowerCase());
    updateDoc(myRef, { typingTo: null }).catch(() => {});

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'messages'), {
        text: msgText,
        sender: userProfile.username.toLowerCase(),
        receiver: targetUsername.toLowerCase(),
        senderName: userProfile.username,
        timestamp: serverTimestamp(),
        read: false,
        replyTo: replyTo ? { text: replyTo.text, from: replyTo.senderName } : null
      });
      setReplyTo(null);
    } catch (e) {}
  };

  const approveUser = async (uId, uidAuth) => {
    const pub = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', uId);
    const priv = doc(db, 'artifacts', appId, 'users', uidAuth, 'profile', 'data');
    await updateDoc(pub, { status: 'approved' });
    await updateDoc(priv, { status: 'approved' });
  };

  // --- Views ---

  if (view === 'loading') return (
    <div className="h-screen bg-slate-50 flex items-center justify-center text-blue-600 font-bold italic animate-pulse">
      Loading Session...
    </div>
  );

  if (view === 'login') return (
    <div className="flex items-center justify-center min-h-screen bg-white p-6 font-sans">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-100 text-white">
            <Lock size={28} />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Kwite Chat</h1>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mt-2 italic">
            {isRegistering ? 'Register New Account' : 'Authorized Access Only'}
          </p>
        </div>
        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Username</label>
            <input 
              type="text" 
              value={usernameInput} 
              onChange={(e) => setUsernameInput(e.target.value)} 
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium" 
              placeholder="e.g. admin" 
            />
          </div>
          <div className="space-y-1">
             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Password</label>
             <input 
               type="password" 
               value={passwordInput} 
               onChange={(e) => setPasswordInput(e.target.value)} 
               className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium" 
               placeholder="••••••••" 
             />
          </div>
          {error && <p className="text-red-500 text-[11px] font-bold bg-red-50 p-4 rounded-xl border border-red-100 leading-tight text-center">{error}</p>}
          <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-blue-100 uppercase tracking-widest mt-2 active:scale-95">
            {loading ? 'Processing...' : (isRegistering ? 'Create Account' : 'Sign In')}
          </button>
        </form>
        <button 
          onClick={() => {setIsRegistering(!isRegistering); setError("");}} 
          className="w-full mt-8 text-sm text-slate-400 hover:text-blue-600 font-bold uppercase tracking-wider transition-colors"
        >
          {isRegistering ? "Already have an account? Sign In" : "Request Access? Create Account"}
        </button>
      </div>
    </div>
  );

  if (view === 'pending') return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
      <div className="max-w-xs bg-white p-10 rounded-[32px] border border-slate-200 shadow-sm">
        <Clock className="w-16 h-16 text-amber-500 mx-auto mb-6 animate-pulse" />
        <h1 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-tighter">Pending</h1>
        <p className="text-slate-500 text-xs font-medium leading-relaxed mb-8 italic">
          @{userProfile?.username}, your credentials are valid, but your access hasn't been enabled by an administrator yet.
        </p>
        <button onClick={() => signOut(auth)} className="text-slate-400 hover:text-red-500 font-black text-[10px] uppercase tracking-widest transition-colors">Sign Out</button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-white text-slate-800 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-80 bg-slate-50 border-r border-slate-200">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${userProfile?.isAdmin ? 'bg-indigo-600' : 'bg-blue-600'}`}>
              <User size={20} />
            </div>
            <div>
              <p className="text-sm font-black truncate">@{userProfile?.username}</p>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">{userProfile?.isAdmin ? 'Global Admin' : 'Secure User'}</p>
            </div>
          </div>
          <button onClick={() => signOut(auth)} className="text-slate-300 hover:text-red-500 transition-colors"><LogOut size={18} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {userProfile?.isAdmin && availableUsers.filter(u => u.status === 'pending').length > 0 && (
            <div>
              <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest px-2 mb-2">Requests</p>
              {availableUsers.filter(u => u.status === 'pending').map(u => (
                <div key={u.uidKey} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl mb-1 shadow-sm">
                  <p className="text-xs font-bold text-slate-700 truncate">@{u.username}</p>
                  <button onClick={() => approveUser(u.uidKey, u.uid)} className="p-1.5 bg-green-50 text-green-600 hover:bg-green-600 hover:text-white rounded-lg transition-colors">
                    <UserPlus size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-2">Active Sessions</p>
            <div className="space-y-1">
              {userProfile?.isAdmin ? (
                availableUsers.filter(u => u.status === 'approved').map(u => {
                  const status = getStatus(u);
                  return (
                    <button 
                        key={u.uidKey} 
                        onClick={() => { setTargetUsername(u.uidKey); setTargetUserProfile(u); }} 
                        className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all ${targetUsername === u.uidKey ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200'}`}
                    >
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500">
                          {u.username[0].toUpperCase()}
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-slate-50 rounded-full ${status.color}`}></div>
                      </div>
                      <div className="text-left overflow-hidden flex-1">
                        <p className={`text-sm font-bold truncate ${targetUsername === u.uidKey ? 'text-white' : 'text-slate-700'}`}>@{u.username}</p>
                        <p className={`text-[10px] truncate font-medium ${targetUsername === u.uidKey ? 'text-blue-100' : 'text-slate-400'}`}>
                            {status.isTyping ? "Typing..." : status.label}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                targetUserProfile && (
                  <button className="w-full flex items-center gap-3 p-4 rounded-2xl bg-blue-600 text-white shadow-xl shadow-blue-100">
                    <ShieldCheck size={20} />
                    <div className="text-left">
                      <p className="font-black text-sm uppercase tracking-tighter">Administrator</p>
                      <p className="text-[10px] opacity-80 font-bold tracking-widest">@{targetUserProfile.username}</p>
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Chat */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {!targetUsername ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 p-10 text-center">
            <MessageSquare size={56} className="opacity-10 mb-6" />
            <h2 className="text-xl font-black text-slate-400 uppercase tracking-tighter italic">Secure Gateway</h2>
            <p className="text-[10px] font-bold opacity-60 mt-2 uppercase tracking-[0.2em]">Select a session or press ESC</p>
          </div>
        ) : (
          <>
            <header className="h-20 flex items-center px-6 bg-white border-b border-slate-100 gap-4 shrink-0">
              <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-blue-600 shadow-sm"><User size={20} /></div>
              <div className="flex-1">
                <h2 className="font-black text-slate-800 text-sm">@{targetUserProfile?.username || targetUsername}</h2>
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${getStatus(targetUserProfile).color} ${getStatus(targetUserProfile).isTyping ? 'animate-pulse' : ''}`}></div>
                  <p className={`text-[10px] font-bold uppercase tracking-tighter ${getStatus(targetUserProfile).isTyping ? 'text-green-600' : 'text-slate-400'}`}>
                    {getStatus(targetUserProfile).label}
                  </p>
                </div>
              </div>
              <button onClick={() => {setTargetUsername(null); setTargetUserProfile(null);}} className="text-[9px] font-black text-slate-300 uppercase hover:text-red-500 transition-colors tracking-widest border border-slate-200 px-3 py-1.5 rounded-lg">Close (ESC)</button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 bg-slate-50/20">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col group ${msg.sender === userProfile.username.toLowerCase() ? 'items-end' : 'items-start'}`}>
                  <div className="flex flex-col max-w-[85%]">
                    {msg.replyTo && (
                      <div className="bg-white border-l-2 border-blue-400 p-2 mb-1 rounded-lg text-[10px] text-slate-400 italic truncate shadow-sm">
                        {msg.from}: {msg.replyTo.text}
                      </div>
                    )}
                    <div className={`relative px-5 py-3.5 rounded-3xl text-sm shadow-sm break-words whitespace-pre-wrap ${msg.sender === userProfile.username.toLowerCase() ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-700 rounded-bl-none border border-slate-200'}`}>
                      {msg.text}
                      <button onClick={() => setReplyTo(msg)} className={`absolute -top-3 p-2 bg-white border border-slate-200 text-slate-400 rounded-xl opacity-0 group-hover:opacity-100 transition-all shadow-md hover:text-blue-600 ${msg.sender === userProfile.username.toLowerCase() ? '-left-10' : '-right-10'}`}>
                        <Reply size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 px-1 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    {formatMessageTime(msg.timestamp)}
                    {msg.sender === userProfile.username.toLowerCase() && (msg.read ? <CheckCheck size={14} className="text-blue-500" /> : <Check size={14} />)}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>

            <footer className="p-6 bg-white border-t border-slate-100 shrink-0">
              {replyTo && (
                <div className="max-w-4xl mx-auto mb-4 flex items-center justify-between bg-blue-50 border border-blue-100 px-4 py-3 rounded-2xl">
                    <p className="truncate text-[11px] font-bold text-blue-700 italic">Replying to message...</p>
                    <button onClick={() => setReplyTo(null)} className="text-blue-300 hover:text-blue-600"><CheckCircle size={18} /></button>
                </div>
              )}
              <div className="max-w-4xl mx-auto flex gap-3 items-end">
                <textarea 
                  value={newMessage} 
                  onChange={(e) => setNewMessage(e.target.value)} 
                  onKeyDown={(e) => { 
                    if (e.key === 'Enter' && !e.shiftKey) { 
                        e.preventDefault(); 
                        handleSendMessage(); 
                    } 
                  }}
                  placeholder="Type a message..." 
                  rows={1}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-[24px] px-6 py-4 text-sm focus:outline-none focus:border-blue-500 transition-all text-slate-800 shadow-inner resize-none min-h-[56px] max-h-40 leading-relaxed" 
                />
                <button type="button" onClick={handleSendMessage} disabled={!newMessage.trim()} className="bg-blue-600 text-white p-4 rounded-2xl shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50 disabled:shadow-none active:scale-90 shrink-0">
                  <Send size={20} />
                </button>
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}