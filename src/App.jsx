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
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(''); 
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const scrollRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Helper for Last Seen / Active Status
  const getStatus = (profile) => {
    if (!profile?.lastSeen) return { label: "Offline", color: "bg-slate-300", isTyping: false };
    
    // Check if they are typing to ME
    if (profile.typingTo === userProfile?.username?.toLowerCase()) {
        return { label: "Typing...", color: "bg-green-500", isTyping: true };
    }

    const date = profile.lastSeen.toDate ? profile.lastSeen.toDate() : new Date(profile.lastSeen);
    const diff = (new Date() - date) / 1000 / 60; 
    if (diff < 3) return { label: "Active Now", color: "bg-green-500", isTyping: false };
    
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isToday = date.toDateString() === new Date().toDateString();
    const label = isToday ? `Last seen at ${timeStr}` : `Last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    return { label, color: "bg-slate-300", isTyping: false };
  };

  const formatMessageTime = (timestamp) => {
    if (!timestamp) return "sending...";
    const date = timestamp.toDate();
    const now = new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) return timeStr;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  };

  // Global "ESC" listener to close chat
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        setTargetUsername(null);
        setTargetUserProfile(null);
        setReplyTo(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // Presence & Typing Status "Heartbeat"
  useEffect(() => {
    if (!userProfile) return;
    const myUsernameId = userProfile.username.toLowerCase();
    const myRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', myUsernameId);

    const updatePresence = async (isTyping = false) => {
      await updateDoc(myRef, { 
        lastSeen: serverTimestamp(),
        typingTo: isTyping ? targetUsername?.toLowerCase() || null : null
      }).catch(() => {});
    };

    // Update typing status whenever newMessage changes
    if (newMessage.trim().length > 0 && targetUsername) {
        updatePresence(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => updatePresence(false), 3000);
    } else {
        updatePresence(false);
    }

    const presenceInterval = setInterval(() => updatePresence(newMessage.trim().length > 0), 120000);
    return () => {
        clearInterval(presenceInterval);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [userProfile, newMessage, targetUsername]);

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

  // 2. Sidebar Data & Target Profile Updates
  useEffect(() => {
    if (userProfile && user) {
      const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_users');
      return onSnapshot(usersRef, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ usernameId: doc.id, ...doc.data() }));
        if (userProfile.isAdmin) {
            setAvailableUsers(users.filter(u => u.usernameId !== userProfile.username.toLowerCase()));
        }
        // Update the current target profile data (for typing/presence)
        if (targetUsername) {
            const updatedTarget = users.find(u => u.usernameId === targetUsername.toLowerCase());
            if (updatedTarget) setTargetUserProfile(updatedTarget);
        }
      });
    }
  }, [userProfile, user, targetUsername]);

  // 3. Chat Logic
  useEffect(() => {
    if (!user || !userProfile || !targetUsername || view !== 'chat') return;
    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const myUname = userProfile.username.toLowerCase();
      const theirUname = targetUsername.toLowerCase();
      const filtered = msgs.filter(m => 
        (m.senderUsername === myUname && m.receiverUsername === theirUname) ||
        (m.senderUsername === theirUname && m.receiverUsername === myUname)
      );
      setMessages(filtered);
      const batch = writeBatch(db);
      let hasUpdates = false;
      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.receiverUsername === myUname && data.senderUsername === theirUname && !data.read) {
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

  const handleAuth = async (e) => {
    e.preventDefault();
    const cleanUsername = username.toLowerCase().trim();
    if (!cleanUsername || !password) return setError("Please enter all fields.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    setLoading(true);
    setError("");
    try {
      if (isRegistering) {
        const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', cleanUsername);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setLoading(false);
          return setError("Username taken.");
        }
        const isFirstAdmin = cleanUsername === 'admin';
        const cred = await createUserWithEmailAndPassword(auth, formatEmail(cleanUsername), password);
        const profileData = {
          username: username,
          status: isFirstAdmin ? 'approved' : 'pending',
          uid: cred.user.uid,
          isAdmin: isFirstAdmin, 
          lastSeen: serverTimestamp(),
          typingTo: null,
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'artifacts', appId, 'users', cred.user.uid, 'profile', 'data'), profileData);
        await setDoc(userRef, profileData);
      } else {
        await signInWithEmailAndPassword(auth, formatEmail(cleanUsername), password);
      }
    } catch (err) {
      setError("Invalid credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() || !user || !userProfile || !targetUsername) return;
    const textToSend = newMessage.trim();
    setNewMessage('');
    
    // Clear typing status immediately on send
    const myRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', userProfile.username.toLowerCase());
    updateDoc(myRef, { typingTo: null }).catch(() => {});

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'messages'), {
        text: textToSend,
        senderUsername: userProfile.username.toLowerCase(),
        receiverUsername: targetUsername.toLowerCase(),
        senderDisplayName: userProfile.username,
        timestamp: serverTimestamp(),
        read: false,
        replyTo: replyTo ? { text: replyTo.text, senderName: replyTo.senderDisplayName } : null
      });
      setReplyTo(null);
    } catch (e) {}
  };

  const approveUser = async (targetUnameId, targetUid) => {
    const pubRef = doc(db, 'artifacts', appId, 'public', 'data', 'all_users', targetUnameId);
    const privRef = doc(db, 'artifacts', appId, 'users', targetUid, 'profile', 'data');
    await updateDoc(pubRef, { status: 'approved' });
    await updateDoc(privRef, { status: 'approved' });
  };

  if (view === 'loading') return <div className="h-screen bg-slate-50 flex items-center justify-center text-blue-600 font-bold italic">Kwite Chat...</div>;

  if (view === 'login') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white p-6 font-sans text-slate-900">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-100 text-white"><Lock size={28} /></div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Kwite Chat</h1>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">1-to-1 Secure Link</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 outline-none transition-all placeholder:text-slate-400 font-medium" placeholder="Username" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-slate-900 outline-none transition-all placeholder:text-slate-400 font-medium" placeholder="Password" />
            {error && <p className="text-red-500 text-xs font-bold bg-red-50 p-4 rounded-xl border border-red-100">{error}</p>}
            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-blue-100 uppercase tracking-widest">{loading ? '...' : (isRegistering ? 'Create Account' : 'Sign In')}</button>
          </form>
          <button onClick={() => { setIsRegistering(!isRegistering); setError(""); }} className="w-full mt-8 text-sm text-slate-400 hover:text-blue-600 font-bold uppercase tracking-wider transition-colors">{isRegistering ? "Back to Login" : "Register Account"}</button>
        </div>
      </div>
    );
  }

  if (view === 'pending') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
        <div className="max-w-xs">
          <Clock className="w-16 h-16 text-amber-500 mx-auto mb-6 animate-pulse" />
          <h1 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-tighter tracking-tight">Pending</h1>
          <p className="text-slate-500 text-sm font-medium leading-relaxed mb-8">@{userProfile?.username}, please wait for the Admin to approve your session.</p>
          <button onClick={() => signOut(auth)} className="text-slate-400 hover:text-red-500 font-black text-xs uppercase tracking-widest transition-colors">Log Out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white text-slate-800 font-sans overflow-hidden">
      <aside className="hidden md:flex flex-col w-80 bg-slate-50 border-r border-slate-200">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${userProfile?.isAdmin ? 'bg-indigo-600' : 'bg-blue-600'}`}><User size={20} /></div>
            <div>
              <p className="text-sm font-black truncate">@{userProfile?.username}</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Verified User</p>
            </div>
          </div>
          <button onClick={() => signOut(auth)} className="text-slate-300 hover:text-red-500 transition-colors"><LogOut size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {userProfile?.isAdmin && (
            <div>
              <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest px-2 mb-2">Approvals</p>
              {availableUsers.filter(u => u.status === 'pending').map(u => (
                <div key={u.usernameId} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl mb-1 shadow-sm">
                  <p className="text-xs font-bold text-slate-700 truncate">@{u.username}</p>
                  <button onClick={() => approveUser(u.usernameId, u.uid)} className="p-1.5 bg-green-50 text-green-600 hover:bg-green-600 hover:text-white rounded-lg"><UserPlus size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-2">Conversations</p>
            <div className="space-y-1">
              {userProfile?.isAdmin ? (
                availableUsers.filter(u => u.status === 'approved').map(u => {
                  const status = getStatus(u);
                  return (
                    <button key={u.usernameId} onClick={() => { setTargetUsername(u.usernameId); setTargetUserProfile(u); }} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${targetUsername === u.usernameId ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}>
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center text-[10px] font-black text-slate-500">{u.username[0].toUpperCase()}</div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-slate-50 rounded-full ${status.color}`}></div>
                      </div>
                      <div className="text-left overflow-hidden flex-1">
                        <p className={`text-sm font-bold truncate ${targetUsername === u.usernameId ? 'text-white' : 'text-slate-700'}`}>@{u.username}</p>
                        <p className={`text-[10px] truncate font-medium ${targetUsername === u.usernameId ? 'text-blue-100' : 'text-slate-400'}`}>
                            {status.isTyping ? "Typing..." : status.label}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                targetUserProfile && (
                  <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-blue-600 text-white shadow-lg"><ShieldCheck size={18} /><div className="text-left"><p className="font-bold text-sm">Administrator</p><p className="text-[10px] opacity-80 uppercase tracking-tighter">@{targetUserProfile.username}</p></div></button>
                )
              )}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {!targetUsername ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 p-10 text-center">
            <MessageSquare size={48} className="opacity-20 mb-4" />
            <h2 className="text-lg font-black text-slate-400 uppercase tracking-tighter italic">Secure Link</h2>
            <p className="text-xs opacity-60 mt-1">Select a session or press ESC to exit.</p>
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
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 bg-slate-50/10">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col group ${msg.senderUsername === userProfile.username.toLowerCase() ? 'items-end' : 'items-start'}`}>
                  <div className="flex flex-col max-w-[85%]">
                    {msg.replyTo && (
                      <div className="bg-white border-l-2 border-blue-400 p-2 mb-1 rounded-lg text-[10px] text-slate-400 italic truncate shadow-sm">{msg.replyTo.text}</div>
                    )}
                    <div className={`relative px-4 py-3 rounded-2xl text-sm shadow-sm break-words whitespace-pre-wrap ${msg.senderUsername === userProfile.username.toLowerCase() ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-700 rounded-bl-none border border-slate-200'}`}>
                      {msg.text}
                      <button onClick={() => setReplyTo(msg)} className={`absolute -top-2 p-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all shadow-sm ${msg.senderUsername === userProfile.username.toLowerCase() ? '-left-8' : '-right-8'}`}><Reply size={12} /></button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 px-1 text-[9px] font-bold text-slate-400 uppercase tracking-tight">
                    {formatMessageTime(msg.timestamp)}
                    {msg.senderUsername === userProfile.username.toLowerCase() && (msg.read ? <CheckCheck size={12} className="text-blue-500" /> : <Check size={12} />)}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>

            <footer className="p-4 bg-white border-t border-slate-100 shrink-0">
              {replyTo && (
                <div className="max-w-4xl mx-auto mb-3 flex items-center justify-between bg-blue-50 border border-blue-100 p-3 rounded-xl"><p className="truncate text-xs font-bold text-blue-700 italic font-medium">Replying...</p><button onClick={() => setReplyTo(null)} className="text-blue-300 hover:text-blue-600 transition-colors"><CheckCircle size={16} /></button></div>
              )}
              <div className="max-w-4xl mx-auto flex gap-2 items-end">
                <textarea 
                  value={newMessage} 
                  onChange={(e) => setNewMessage(e.target.value)} 
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  placeholder={`Message @${targetUserProfile?.username || 'User'}...`} 
                  rows={1}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-blue-500 transition-all text-slate-800 shadow-inner resize-none min-h-[56px] max-h-32" 
                />
                <button type="button" onClick={handleSendMessage} disabled={!newMessage.trim()} className="bg-blue-600 text-white p-4 rounded-2xl shadow-lg hover:bg-blue-700 transition-all disabled:opacity-50 shrink-0"><Send size={20} /></button>
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}