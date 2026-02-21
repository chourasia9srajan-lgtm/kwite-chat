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
  setDoc,
  getDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { Send, User, ShieldCheck, Clock, CheckCircle, Reply, Check, CheckCheck, LogOut, MessageSquare, UserPlus } from 'lucide-react';

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

// Internal helper for Auth email
const formatEmail = (uname) => `${uname.toLowerCase().trim()}@kwite.chat`;

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
  
  // Auth Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(''); 
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef(null);

  // Helper to format the timestamp intelligently
  const formatMessageTime = (timestamp) => {
    if (!timestamp) return "sending...";
    const date = timestamp.toDate();
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return timeStr;
    
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  };

  // 1. Auth & Profile Management
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currUser) => {
      if (currUser) {
        setUser(currUser);
        const profileRef = doc(db, 'artifacts', appId, 'users', currUser.uid, 'profile', 'data');
        
        onSnapshot(profileRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserProfile(data);
            if (data.isAdmin || data.status === 'approved') {
              setView('chat');
              if (!data.isAdmin) fetchAdminInfo();
            } else {
              setView('pending');
            }
          } else {
            setView('login');
          }
        });
      } else {
        setUser(null);
        setView('login');
      }
    });
    return () => unsubscribeAuth();
  }, []);

  const fetchAdminInfo = async () => {
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_users');
    onSnapshot(usersRef, (snapshot) => {
      const adminDoc = snapshot.docs.find(d => d.data().isAdmin === true);
      if (adminDoc) {
        setTargetUsername(adminDoc.id); 
        setTargetUserProfile(adminDoc.data());
      }
    });
  };

  // 2. Admin Logic: Fetch all users based on Username ID
  useEffect(() => {
    if (userProfile?.isAdmin && user) {
      const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_users');
      return onSnapshot(usersRef, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ usernameId: doc.id, ...doc.data() }));
        setAvailableUsers(users.filter(u => u.usernameId !== userProfile.username.toLowerCase()));
      });
    }
  }, [userProfile, user]);

  // 3. Chat Logic
  useEffect(() => {
    if (!user || !userProfile || !targetUsername || view !== 'chat') return;

    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const myUsername = userProfile.username.toLowerCase();
      const theirUsername = targetUsername.toLowerCase();

      const filtered = msgs.filter(m => 
        (m.senderUsername === myUsername && m.receiverUsername === theirUsername) ||
        (m.senderUsername === theirUsername && m.receiverUsername === myUsername)
      );
      setMessages(filtered);

      const batch = writeBatch(db);
      let hasUpdates = false;
      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.receiverUsername === myUsername && data.senderUsername === theirUsername && !data.read) {
          batch.update(docSnap.ref, { read: true, readAt: serverTimestamp() });
          hasUpdates = true;
        }
      });
      if (hasUpdates) batch.commit().catch(() => {});
    });

    return () => unsubscribe();
  }, [user, userProfile, targetUsername, view]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Handlers ---

  const handleRegister = async (e) => {
    e.preventDefault();
    const cleanUsername = username.toLowerCase().trim();
    if (!cleanUsername || !password || password.length < 6) return setError("Min 6 chars.");
    
    setLoading(true);
    setError("");

    try {
      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', cleanUsername);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        setLoading(false);
        return setError("Username already taken.");
      }

      const isFirstAdmin = cleanUsername === 'admin';
      const cred = await createUserWithEmailAndPassword(auth, formatEmail(cleanUsername), password);
      
      const profileData = {
        username: username,
        status: isFirstAdmin ? 'approved' : 'pending',
        uid: cred.user.uid,
        isAdmin: isFirstAdmin, 
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'artifacts', appId, 'users', cred.user.uid, 'profile', 'data'), profileData);
      await setDoc(userRef, profileData);
      
    } catch (err) {
      setError("Error creating account. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, formatEmail(username), password);
    } catch (err) {
      setError("Invalid credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !userProfile || !targetUsername) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'messages'), {
        text: newMessage,
        senderUsername: userProfile.username.toLowerCase(),
        receiverUsername: targetUsername.toLowerCase(),
        senderDisplayName: userProfile.username,
        timestamp: serverTimestamp(),
        read: false,
        replyTo: replyTo ? { text: replyTo.text, senderName: replyTo.senderDisplayName } : null
      });
      setNewMessage('');
      setReplyTo(null);
    } catch (e) {}
  };

  const approveUser = async (targetUnameId, targetUid) => {
    const pubRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', targetUnameId);
    const privRef = doc(db, 'artifacts', appId, 'users', targetUid, 'profile', 'data');
    await updateDoc(pubRef, { status: 'approved' });
    await updateDoc(privRef, { status: 'approved' });
  };

  if (view === 'loading') return <div className="h-screen bg-slate-50 flex items-center justify-center text-blue-600 font-medium italic tracking-wide">Connecting...</div>;

  if (view === 'login' || view === 'register') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4 font-sans">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <ShieldCheck className="text-white" size={32} />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-slate-800 mb-6 tracking-tight">
            {view === 'login' ? 'Kwite Chat' : 'Create Account'}
          </h1>
          <form onSubmit={view === 'login' ? handleLogin : handleRegister} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase px-1 tracking-wider">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-slate-800 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="Enter username" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase px-1 tracking-wider">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-slate-800 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all" placeholder="••••••••" />
            </div>
            {error && <p className="text-red-500 text-xs text-center font-bold bg-red-50 py-2 rounded-lg border border-red-100">{error}</p>}
            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-100 uppercase">
              {loading ? 'Processing...' : (view === 'login' ? 'Sign In' : 'Join Now')}
            </button>
          </form>
          <button onClick={() => { setView(view === 'login' ? 'register' : 'login'); setError(""); }} className="w-full mt-6 text-sm text-slate-400 hover:text-blue-600 font-medium transition-colors">
            {view === 'login' ? "Register a new account" : "Already have an account? Sign In"}
          </button>
        </div>
      </div>
    );
  }

  if (view === 'pending') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4 text-center">
        <div className="max-w-md bg-white border border-slate-200 p-10 rounded-3xl shadow-lg">
          <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-500">
            <Clock className="w-10 h-10 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Approval Required</h1>
          <p className="text-slate-500 text-sm mb-8 leading-relaxed">
            Your account <b>@{userProfile?.username}</b> has been registered. Please wait for an administrator to grant you access.
          </p>
          <button onClick={() => signOut(auth)} className="text-slate-400 hover:text-red-500 font-bold text-sm uppercase tracking-widest transition-colors">Log Out</button>
        </div>
      </div>
    );
  }

  const pendingRequests = availableUsers.filter(u => u.status === 'pending');
  const activeChats = availableUsers.filter(u => u.status === 'approved');

  return (
    <div className="flex h-screen bg-white text-slate-800 font-sans overflow-hidden">
      <aside className="hidden md:flex flex-col w-80 bg-slate-50 border-r border-slate-200">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm ${userProfile?.isAdmin ? 'bg-indigo-600' : 'bg-blue-600'}`}>
              <User size={20} />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">@{userProfile?.username}</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                {userProfile?.isAdmin ? 'Administrator' : 'User Session'}
              </p>
            </div>
          </div>
          <button onClick={() => signOut(auth)} className="text-slate-300 hover:text-red-500 transition-colors ml-2"><LogOut size={18} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {userProfile?.isAdmin && pendingRequests.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest px-2 mb-2">New Approvals</p>
              <div className="space-y-1">
                {pendingRequests.map(u => (
                  <div key={u.usernameId} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                    <p className="text-xs font-bold text-slate-700 truncate mr-2">@{u.username}</p>
                    <button onClick={() => approveUser(u.usernameId, u.uid)} className="p-1.5 bg-green-50 text-green-600 hover:bg-green-600 hover:text-white rounded-lg transition-all">
                      <UserPlus size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-2">
              {userProfile?.isAdmin ? "Direct Chats" : "Contact Admin"}
            </p>
            <div className="space-y-1">
              {userProfile?.isAdmin ? (
                activeChats.length === 0 ? (
                  <p className="text-xs text-slate-400 px-2 italic">No active conversations.</p>
                ) : (
                  activeChats.map(u => (
                    <button 
                      key={u.usernameId} 
                      onClick={() => { setTargetUsername(u.usernameId); setTargetUserProfile(u); }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all border ${targetUsername === u.usernameId ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-transparent border-transparent text-slate-500 hover:bg-slate-200'}`}
                    >
                      <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold ${targetUsername === u.usernameId ? 'bg-blue-500' : 'bg-slate-200'}`}>
                        {u.username[0].toUpperCase()}
                      </div>
                      <div className="text-left overflow-hidden">
                        <p className={`text-sm font-bold truncate ${targetUsername === u.usernameId ? 'text-white' : 'text-slate-700'}`}>@{u.username}</p>
                        <p className={`text-[10px] truncate ${targetUsername === u.usernameId ? 'text-blue-100' : 'text-slate-400'}`}>Message user</p>
                      </div>
                    </button>
                  ))
                )
              ) : (
                targetUserProfile && (
                  <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-100">
                    <ShieldCheck size={18} />
                    <div className="text-left">
                      <p className="font-bold text-sm">Administrator</p>
                      <p className="text-[10px] text-blue-100 opacity-80 uppercase tracking-tighter">@{targetUserProfile.username}</p>
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {!targetUsername ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 p-10 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <MessageSquare size={40} className="opacity-40" />
            </div>
            <h2 className="text-lg font-bold text-slate-400 italic">Kwite Chat Session</h2>
            <p className="text-xs max-w-xs leading-relaxed opacity-60">
              Select a conversation from the sidebar to begin messaging.
            </p>
          </div>
        ) : (
          <>
            <header className="h-20 flex items-center px-6 bg-white border-b border-slate-100 gap-4">
              <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-blue-600 shadow-sm">
                <User size={20} />
              </div>
              <div className="flex-1">
                <h2 className="font-bold text-slate-800 text-sm">@{targetUserProfile?.username || targetUsername}</h2>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Active Connection</p>
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 bg-slate-50/20">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                   <div className="p-3 bg-white rounded-xl border border-slate-100 text-[10px] uppercase font-bold tracking-widest shadow-sm">
                     Start messaging
                   </div>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col group ${msg.senderUsername === userProfile.username.toLowerCase() ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-end gap-2 max-w-[85%]">
                    <div className="flex flex-col">
                      {msg.replyTo && (
                        <div className="bg-white border-l-2 border-blue-400 p-2 mb-1 rounded-lg text-[10px] text-slate-400 italic truncate max-w-[200px] shadow-sm">
                          {msg.replyTo.text}
                        </div>
                      )}
                      <div className={`relative px-4 py-3 rounded-2xl text-sm shadow-sm ${msg.senderUsername === userProfile.username.toLowerCase() ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-700 rounded-bl-none border border-slate-200'}`}>
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        <button onClick={() => setReplyTo(msg)} className={`absolute -top-2 p-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all shadow-sm hover:text-blue-600 ${msg.senderUsername === userProfile.username.toLowerCase() ? '-left-8' : '-right-8'}`}>
                          <Reply size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Updated Timestamp Display */}
                  <div className="flex items-center gap-1.5 mt-1.5 px-1 text-[9px] font-bold text-slate-400 uppercase tracking-tight">
                    {formatMessageTime(msg.timestamp)}
                    {msg.senderUsername === userProfile.username.toLowerCase() && (msg.read ? <CheckCheck size={12} className="text-blue-500" /> : <Check size={12} />)}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>

            <footer className="p-4 bg-white border-t border-slate-100">
              {replyTo && (
                <div className="max-w-4xl mx-auto mb-3 flex items-center justify-between bg-blue-50 border border-blue-100 p-3 rounded-xl">
                  <p className="truncate text-xs font-bold text-blue-700">Replying to message</p>
                  <button onClick={() => setReplyTo(null)} className="text-blue-300 hover:text-blue-600 transition-colors shrink-0 ml-4"><CheckCircle size={16} /></button>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2">
                <input 
                  type="text" 
                  value={newMessage} 
                  onChange={(e) => setNewMessage(e.target.value)} 
                  placeholder="Type a message..." 
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-blue-500 transition-all text-slate-800 shadow-inner" 
                />
                <button type="submit" disabled={!newMessage.trim()} className="bg-blue-600 text-white p-4 rounded-2xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50">
                  <Send size={20} />
                </button>
              </form>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}