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
import { Send, User, MessageCircle, LogIn, Hash, ShieldCheck, Clock, UserPlus, CheckCircle, XCircle, Reply, Check, CheckCheck, LogOut } from 'lucide-react';

// --- Production Firebase Configuration ---
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

// Helper to map username to a unique internal email for Firebase Auth
const formatEmail = (uname) => `${uname.toLowerCase().trim()}@kwite.chat`;

export default function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [targetUserId, setTargetUserId] = useState('Global-Lobby');
  const [targetUserProfile, setTargetUserProfile] = useState(null);
  const [view, setView] = useState('loading'); 
  const [pendingUsers, setPendingUsers] = useState([]);
  
  // Auth Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(''); 
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef(null);

  // 1. Authentication and Profile Sync
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currUser) => {
      if (currUser) {
        setUser(currUser);
        const profileRef = doc(db, 'artifacts', appId, 'users', currUser.uid, 'profile', 'data');
        
        // Mark Online
        updateDoc(profileRef, { 
          isOnline: true, 
          lastSeen: serverTimestamp() 
        }).catch(() => {});

        const unsubProfile = onSnapshot(profileRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserProfile(data);
            if (data.isAdmin) setView('admin');
            else if (data.status === 'approved') setView('chat');
            else setView('pending');
          } else {
            setView('login');
          }
        }, () => setView('login'));

        return () => {
          unsubProfile();
          updateDoc(profileRef, { isOnline: false, lastSeen: serverTimestamp() }).catch(() => {});
        };
      } else {
        setUser(null);
        setUserProfile(null);
        setView('login');
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // 2. Presence Tracking for Chat Partner
  useEffect(() => {
    if (!user || targetUserId === 'Global-Lobby') {
      setTargetUserProfile(null);
      return;
    }
    const targetRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', targetUserId);
    return onSnapshot(targetRef, (docSnap) => {
      if (docSnap.exists()) setTargetUserProfile(docSnap.data());
    });
  }, [user, targetUserId]);

  // 3. Admin: Load Pending Users
  useEffect(() => {
    if (userProfile?.isAdmin && user) {
      const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_users');
      return onSnapshot(usersRef, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPendingUsers(users.filter(u => u.status === 'pending'));
      });
    }
  }, [userProfile, user]);

  // 4. Chat Engine: Messages and Read Status
  useEffect(() => {
    if (!user || (view !== 'chat' && view !== 'admin')) return;

    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const filtered = msgs.filter(m => 
        (m.senderId === user.uid && m.receiverId === targetUserId) ||
        (m.senderId === targetUserId && m.receiverId === user.uid) ||
        (targetUserId === 'Global-Lobby' && m.receiverId === 'Global-Lobby')
      );
      setMessages(filtered);

      // Mark as read logic
      if (targetUserId !== 'Global-Lobby') {
        const batch = writeBatch(db);
        let hasUpdates = false;
        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (data.receiverId === user.uid && data.senderId === targetUserId && !data.read) {
            batch.update(docSnap.ref, { read: true, readAt: serverTimestamp() });
            hasUpdates = true;
          }
        });
        if (hasUpdates) batch.commit().catch(() => {});
      }
    });

    return () => unsubscribe();
  }, [user, targetUserId, view]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Handlers ---

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!username || !password || password.length < 6) return setError("Min 6 chars for password.");
    setLoading(true);
    setError("");
    try {
      const cred = await createUserWithEmailAndPassword(auth, formatEmail(username), password);
      const profileData = {
        username: username,
        status: 'pending',
        uid: cred.user.uid,
        isAdmin: username.toLowerCase() === 'admin', 
        createdAt: new Date().toISOString(),
        isOnline: true,
        lastSeen: serverTimestamp()
      };
      await setDoc(doc(db, 'artifacts', appId, 'users', cred.user.uid, 'profile', 'data'), profileData);
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'all_users', cred.user.uid), profileData);
    } catch (err) {
      setError(err.code === 'auth/email-already-in-use' ? "Username taken." : "Registration error.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) return setError("Enter credentials.");
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, formatEmail(username), password);
    } catch (err) {
      setError("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'messages'), {
        text: newMessage,
        senderId: user.uid,
        receiverId: targetUserId,
        senderName: userProfile?.username || 'User',
        timestamp: serverTimestamp(),
        read: false,
        replyTo: replyTo ? { text: replyTo.text, senderName: replyTo.senderName } : null
      });
      setNewMessage('');
      setReplyTo(null);
    } catch (e) {}
  };

  const approveUser = async (targetUid) => {
    const pubRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', targetUid);
    const privRef = doc(db, 'artifacts', appId, 'users', targetUid, 'profile', 'data');
    await updateDoc(pubRef, { status: 'approved' });
    await updateDoc(privRef, { status: 'approved' });
  };

  if (view === 'loading') return <div className="h-screen bg-slate-950 flex items-center justify-center text-blue-500">Loading...</div>;

  if (view === 'login' || view === 'register') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <ShieldCheck className="text-white" size={32} />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-white mb-6 uppercase tracking-widest">{view === 'login' ? 'Kwite Chat Login' : 'Create Account'}</h1>
          <form onSubmit={view === 'login' ? handleLogin : handleRegister} className="space-y-4">
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/50 outline-none" placeholder="Username" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3.5 text-white focus:ring-2 focus:ring-blue-500/50 outline-none" placeholder="Password" />
            {error && <p className="text-red-400 text-xs text-center font-bold bg-red-400/10 py-2 rounded-lg">{error}</p>}
            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl transition-all shadow-lg shadow-blue-600/20 uppercase">
              {loading ? '...' : (view === 'login' ? 'Sign In' : 'Join Now')}
            </button>
          </form>
          <button onClick={() => { setView(view === 'login' ? 'register' : 'login'); setError(""); }} className="w-full mt-6 text-sm text-slate-500 hover:text-blue-400 font-bold">
            {view === 'login' ? "Register New Account" : "Back to Login"}
          </button>
        </div>
      </div>
    );
  }

  if (view === 'pending') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4 text-center">
        <div className="max-w-md bg-slate-900 border border-slate-800 p-10 rounded-3xl shadow-xl">
          <Clock className="w-16 h-16 text-yellow-500 mx-auto mb-6 animate-pulse" />
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Access Restricted</h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">@{userProfile?.username}, your account is in the queue. An admin will grant you access soon. Please check back later.</p>
          <button onClick={() => signOut(auth)} className="text-slate-500 hover:text-red-400 font-bold text-sm uppercase">Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-72 bg-slate-900 border-r border-slate-800">
        <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${userProfile?.isAdmin ? 'bg-purple-600' : 'bg-blue-600'}`}><User size={20} /></div>
            <div className="overflow-hidden">
              <p className="text-sm font-black truncate">@{userProfile?.username}</p>
              <p className="text-[10px] text-green-500 font-bold uppercase tracking-widest">Active</p>
            </div>
          </div>
          <button onClick={() => signOut(auth)} className="text-slate-500 hover:text-red-400"><LogOut size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {userProfile?.isAdmin && (
            <button onClick={() => setView('admin')} className={`w-full flex items-center justify-between p-3 rounded-xl transition-all mb-6 ${view === 'admin' ? 'bg-purple-600 shadow-lg' : 'hover:bg-slate-800 text-slate-400 font-bold text-sm'}`}>
              <div className="flex items-center gap-3"><ShieldCheck size={18} /><span>Approvals</span></div>
              {pendingUsers.length > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{pendingUsers.length}</span>}
            </button>
          )}
          <button onClick={() => { setView('chat'); setTargetUserId('Global-Lobby'); }} className={`w-full flex items-center gap-3 p-3 rounded-xl ${targetUserId === 'Global-Lobby' && view === 'chat' ? 'bg-blue-600' : 'hover:bg-slate-800 text-slate-400'}`}>
            <Hash size={18} /><span className="font-bold text-sm">Global Lobby</span>
          </button>
        </div>
      </aside>

      {/* Chat View */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
        {view === 'admin' ? (
          <div className="flex-1 p-8 overflow-y-auto">
            <h1 className="text-3xl font-black mb-10 text-purple-400 flex items-center gap-3"><ShieldCheck size={32} /> Dashboard</h1>
            <div className="grid gap-4 max-w-2xl">
              {pendingUsers.length === 0 ? <p className="text-slate-500 font-bold italic">No pending requests.</p> : pendingUsers.map(u => (
                <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center text-slate-500 font-bold">{u.username[0].toUpperCase()}</div>
                    <div><h4 className="font-black text-white">@{u.username}</h4><p className="text-[10px] text-slate-500">{u.uid}</p></div>
                  </div>
                  <button onClick={() => approveUser(u.uid)} className="bg-green-500 hover:bg-green-400 text-slate-950 px-5 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2"><CheckCircle size={16} /> Approve</button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <header className="h-20 flex items-center px-6 bg-slate-900/50 border-b border-slate-800 gap-4">
              <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-blue-400"><User size={20} /></div>
              <div>
                <h2 className="font-black text-sm uppercase tracking-widest text-white">{targetUserId === 'Global-Lobby' ? 'Global Lobby' : targetUserProfile?.username}</h2>
                {targetUserId !== 'Global-Lobby' && <p className="text-[10px] font-bold text-slate-500">{targetUserProfile?.isOnline ? <span className="text-green-500">Online Now</span> : 'Last seen recently'}</p>}
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col group ${msg.senderId === user.uid ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-end gap-2 max-w-[80%]">
                    {msg.senderId !== user.uid && <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-500 uppercase">{msg.senderName[0]}</div>}
                    <div className="flex flex-col">
                      {msg.replyTo && <div className="bg-slate-800/50 border-l-4 border-blue-500 p-2 mb-1 rounded-lg text-xs opacity-60 italic truncate">@{msg.replyTo.senderName}: {msg.replyTo.text}</div>}
                      <div className={`relative px-4 py-2.5 rounded-2xl text-sm ${msg.senderId === user.uid ? 'bg-blue-600 text-white rounded-tr-none shadow-lg' : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700'}`}>
                        <p>{msg.text}</p>
                        <button onClick={() => setReplyTo(msg)} className={`absolute -right-10 top-1/2 -translate-y-1/2 p-2 bg-slate-800 rounded-full opacity-0 group-hover:opacity-100 transition-all ${msg.senderId === user.uid ? '-left-10 right-auto' : ''}`}><Reply size={14} /></button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-[9px] font-bold text-slate-500 uppercase">
                    {msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {msg.senderId === user.uid && targetUserId !== 'Global-Lobby' && (msg.read ? <CheckCheck size={12} className="text-blue-400" /> : <Check size={12} />)}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
            <footer className="p-4 bg-slate-900 border-t border-slate-800">
              {replyTo && (
                <div className="max-w-4xl mx-auto mb-3 flex items-center justify-between bg-slate-800 p-3 rounded-xl border-l-4 border-blue-500">
                  <div className="truncate text-xs font-bold text-slate-400">Replying to @{replyTo.senderName}</div>
                  <button onClick={() => setReplyTo(null)}><XCircle size={16} /></button>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2">
                <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                <button type="submit" disabled={!newMessage.trim()} className="bg-blue-600 text-white p-4 rounded-xl shadow-lg hover:bg-blue-500 transition-all"><Send size={20} /></button>
              </form>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}