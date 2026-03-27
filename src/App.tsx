import React, { useState, useEffect, useRef } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  orderBy, 
  limit,
  Timestamp,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  Lead, 
  Appointment, 
  Message, 
  SalesStage, 
  LeadScore, 
  OperationType, 
  FirestoreErrorInfo 
} from './types';
import { getChatResponse } from './services/geminiService';
import { cn } from './lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { 
  MessageSquare, 
  Users, 
  Calendar, 
  TrendingUp, 
  LogOut, 
  Send, 
  CheckCircle2, 
  AlertCircle,
  LayoutDashboard,
  Phone,
  Mail,
  Clock,
  ChevronRight,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

// Error Handler
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'leads' | 'chat'>('dashboard');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    if (user) testConnection();
  }, [user]);

  // Data Listeners
  useEffect(() => {
    if (!user) return;

    const leadsQuery = query(
      collection(db, 'leads'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubLeads = onSnapshot(leadsQuery, (snapshot) => {
      setLeads(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Lead)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'leads'));

    const appointmentsQuery = query(
      collection(db, 'appointments'),
      where('uid', '==', user.uid),
      orderBy('scheduledAt', 'asc')
    );

    const unsubAppointments = onSnapshot(appointmentsQuery, (snapshot) => {
      setAppointments(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Appointment)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'appointments'));

    return () => {
      unsubLeads();
      unsubAppointments();
    };
  }, [user]);

  // Message Listener
  useEffect(() => {
    if (!selectedLead?.id) {
      setMessages([]);
      return;
    }

    const messagesQuery = query(
      collection(db, 'leads', selectedLead.id, 'messages'),
      orderBy('timestamp', 'asc')
    );

    const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
      setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `leads/${selectedLead.id}/messages`));

    return unsubMessages;
  }, [selectedLead]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const startNewChat = async () => {
    if (!user) return;
    try {
      const newLead: Lead = {
        uid: user.uid,
        status: 'INITIAL',
        score: 'COLD',
        source: 'WEB',
        createdAt: new Date().toISOString(),
        lastInteraction: new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'leads'), newLead);
      setSelectedLead({ ...newLead, id: docRef.id });
      setActiveTab('chat');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'leads');
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !selectedLead?.id || !user) return;

    const leadId = selectedLead.id;
    const userMsg = input;
    setInput('');
    setIsTyping(true);

    try {
      // 1. Save user message
      const msgPath = `leads/${leadId}/messages`;
      await addDoc(collection(db, msgPath), {
        leadId: leadId,
        role: 'user',
        content: userMsg,
        timestamp: new Date().toISOString()
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, msgPath));

      // 2. Get AI response
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));
      history.push({ role: 'user', parts: [{ text: userMsg }] });

      const aiResponse = await getChatResponse(history, selectedLead);

      // 3. Save AI message
      await addDoc(collection(db, msgPath), {
        leadId: leadId,
        role: 'model',
        content: aiResponse.message,
        timestamp: new Date().toISOString()
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, msgPath));

      // 4. Update lead state
      const { id, ...leadData } = selectedLead;
      const updatedLeadData = {
        ...leadData,
        status: aiResponse.nextStage as SalesStage,
        score: aiResponse.score as LeadScore,
        name: aiResponse.extractedData?.name || selectedLead.name || '',
        email: aiResponse.extractedData?.email || selectedLead.email || '',
        phone: aiResponse.extractedData?.phone || selectedLead.phone || '',
        intent: aiResponse.extractedData?.intent || selectedLead.intent || '',
        lastInteraction: new Date().toISOString()
      };
      
      await updateDoc(doc(db, 'leads', leadId), updatedLeadData)
        .catch(err => handleFirestoreError(err, OperationType.UPDATE, `leads/${leadId}`));
      
      setSelectedLead({ id: leadId, ...updatedLeadData });

      // 5. Handle Booking if stage is FOLLOW_UP and not already booked
      if (aiResponse.nextStage === 'FOLLOW_UP') {
        const alreadyBooked = appointments.some(a => a.leadId === leadId);
        if (!alreadyBooked) {
          const apptPath = 'appointments';
          await addDoc(collection(db, apptPath), {
            uid: user.uid,
            leadId: leadId,
            scheduledAt: new Date(Date.now() + 86400000).toISOString(), // Mock: 24h from now
            type: 'Solar Consultation',
            createdAt: new Date().toISOString()
          }).catch(err => handleFirestoreError(err, OperationType.CREATE, apptPath));
        }
      }

    } catch (err) {
      console.error("Chat error", err);
    } finally {
      setIsTyping(false);
    }
  };

  if (loading) return (
    <div className="h-screen w-full flex items-center justify-center bg-[#050505]">
      <motion.div 
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="text-orange-500 font-bold text-2xl tracking-tighter"
      >
        T&F AUTOMATE
      </motion.div>
    </div>
  );

  if (!user) return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-[#050505] p-6">
      <div className="max-w-md w-full text-center space-y-8">
        <motion.h1 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-6xl font-black text-white tracking-tighter uppercase leading-none"
        >
          AI Sales <br /> <span className="text-orange-500">Revolution</span>
        </motion.h1>
        <p className="text-zinc-500 text-lg">
          The multi-channel AI sales agent platform for high-growth businesses.
        </p>
        <button 
          onClick={handleLogin}
          className="w-full bg-white text-black font-bold py-4 rounded-full hover:bg-orange-500 hover:text-white transition-all transform hover:scale-105"
        >
          Get Started with Google
        </button>
      </div>
    </div>
  );

  const stats = [
    { label: 'Total Leads', value: leads.length, icon: Users, color: 'text-blue-500' },
    { label: 'Hot Leads', value: leads.filter(l => l.score === 'HOT').length, icon: TrendingUp, color: 'text-orange-500' },
    { label: 'Booked Calls', value: appointments.length, icon: Calendar, color: 'text-green-500' },
    { label: 'Conv. Rate', value: leads.length ? Math.round((appointments.length / leads.length) * 100) + '%' : '0%', icon: CheckCircle2, color: 'text-purple-500' },
  ];

  const stageData = [
    { name: 'Initial', value: leads.filter(l => l.status === 'INITIAL').length },
    { name: 'Qualifying', value: leads.filter(l => l.status === 'QUALIFYING').length },
    { name: 'Contact', value: leads.filter(l => l.status === 'CONTACT_COLLECTION').length },
    { name: 'Scheduling', value: leads.filter(l => l.status === 'SCHEDULING').length },
    { name: 'Follow-up', value: leads.filter(l => l.status === 'FOLLOW_UP').length },
  ];

  const scoreData = [
    { name: 'Hot', value: leads.filter(l => l.score === 'HOT').length, color: '#f97316' },
    { name: 'Warm', value: leads.filter(l => l.score === 'WARM').length, color: '#eab308' },
    { name: 'Cold', value: leads.filter(l => l.score === 'COLD').length, color: '#3b82f6' },
  ];

  return (
    <div className="h-screen flex bg-[#050505] text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 md:w-64 border-r border-zinc-800 flex flex-col">
        <div className="p-6">
          <h2 className="hidden md:block text-xl font-black tracking-tighter text-orange-500">T&F AUTOMATE</h2>
          <div className="md:hidden w-8 h-8 bg-orange-500 rounded-lg mx-auto" />
        </div>
        
        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "w-full flex items-center space-x-3 p-3 rounded-xl transition-all",
              activeTab === 'dashboard' ? "bg-white text-black" : "text-zinc-500 hover:bg-zinc-900"
            )}
          >
            <LayoutDashboard size={20} />
            <span className="hidden md:block font-medium">Dashboard</span>
          </button>
          <button 
            onClick={() => setActiveTab('leads')}
            className={cn(
              "w-full flex items-center space-x-3 p-3 rounded-xl transition-all",
              activeTab === 'leads' ? "bg-white text-black" : "text-zinc-500 hover:bg-zinc-900"
            )}
          >
            <Users size={20} />
            <span className="hidden md:block font-medium">Leads</span>
          </button>
          <button 
            onClick={startNewChat}
            className={cn(
              "w-full flex items-center space-x-3 p-3 rounded-xl transition-all",
              activeTab === 'chat' ? "bg-white text-black" : "text-zinc-500 hover:bg-zinc-900"
            )}
          >
            <MessageSquare size={20} />
            <span className="hidden md:block font-medium">New Chat</span>
          </button>
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center space-x-3 p-3 text-zinc-500 hover:text-red-500 transition-colors"
          >
            <LogOut size={20} />
            <span className="hidden md:block font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-8 space-y-8"
            >
              <header>
                <h1 className="text-4xl font-black tracking-tighter uppercase">Overview</h1>
                <p className="text-zinc-500">Real-time sales performance metrics.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat, i) => (
                  <div key={i} className="bg-zinc-900 p-6 rounded-3xl border border-zinc-800">
                    <div className="flex justify-between items-start mb-4">
                      <div className={cn("p-2 rounded-xl bg-black", stat.color)}>
                        <stat.icon size={20} />
                      </div>
                    </div>
                    <div className="text-3xl font-bold">{stat.value}</div>
                    <div className="text-zinc-500 text-sm font-medium uppercase tracking-wider">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800">
                  <h3 className="text-xl font-bold mb-6">Sales Pipeline</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stageData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="name" stroke="#71717a" fontSize={12} />
                        <YAxis stroke="#71717a" fontSize={12} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '12px' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800">
                  <h3 className="text-xl font-bold mb-6">Lead Quality</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={scoreData}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {scoreData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'leads' && (
            <motion.div 
              key="leads"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-8 space-y-8"
            >
              <header className="flex justify-between items-end">
                <div>
                  <h1 className="text-4xl font-black tracking-tighter uppercase">Leads</h1>
                  <p className="text-zinc-500">Manage and track your sales prospects.</p>
                </div>
                <button className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 hover:bg-zinc-800 transition-colors">
                  <Filter size={20} />
                </button>
              </header>

              <div className="bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-widest">
                      <th className="px-6 py-4 font-semibold">Lead</th>
                      <th className="px-6 py-4 font-semibold">Status</th>
                      <th className="px-6 py-4 font-semibold">Score</th>
                      <th className="px-6 py-4 font-semibold">Source</th>
                      <th className="px-6 py-4 font-semibold">Last Interaction</th>
                      <th className="px-6 py-4 font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {leads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-zinc-800/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-bold">{lead.name || 'Anonymous Lead'}</div>
                          <div className="text-xs text-zinc-500">{lead.email || 'No email collected'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter",
                            lead.status === 'FOLLOW_UP' ? "bg-green-500/10 text-green-500" : "bg-zinc-800 text-zinc-400"
                          )}>
                            {lead.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "flex items-center space-x-1 font-bold text-xs",
                            lead.score === 'HOT' ? "text-orange-500" : lead.score === 'WARM' ? "text-yellow-500" : "text-blue-500"
                          )}>
                            <div className={cn("w-2 h-2 rounded-full", lead.score === 'HOT' ? "bg-orange-500" : lead.score === 'WARM' ? "bg-yellow-500" : "bg-blue-500")} />
                            <span>{lead.score}</span>
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-400 font-mono">{lead.source}</td>
                        <td className="px-6 py-4 text-xs text-zinc-500">
                          {format(new Date(lead.lastInteraction), 'MMM d, h:mm a')}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => {
                              setSelectedLead(lead);
                              setActiveTab('chat');
                            }}
                            className="p-2 rounded-lg bg-zinc-800 text-zinc-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-white hover:text-black"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col"
            >
              {/* Chat Header */}
              <header className="p-6 border-b border-zinc-800 flex justify-between items-center bg-[#050505]/80 backdrop-blur-xl sticky top-0 z-10">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-orange-500 flex items-center justify-center font-black text-xl">
                    {selectedLead?.name?.[0] || 'A'}
                  </div>
                  <div>
                    <h2 className="font-bold text-lg">{selectedLead?.name || 'New Prospect'}</h2>
                    <div className="flex items-center space-x-2 text-xs text-zinc-500">
                      <span className="flex items-center space-x-1">
                        <div className={cn("w-1.5 h-1.5 rounded-full", selectedLead?.score === 'HOT' ? "bg-orange-500" : "bg-blue-500")} />
                        <span className="uppercase font-bold tracking-tighter">{selectedLead?.score}</span>
                      </span>
                      <span>•</span>
                      <span className="uppercase font-bold tracking-tighter">{selectedLead?.status.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition-colors">
                    <Phone size={18} />
                  </button>
                  <button className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition-colors">
                    <Mail size={18} />
                  </button>
                </div>
              </header>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center text-orange-500">
                      <MessageSquare size={32} />
                    </div>
                    <div>
                      <h3 className="font-bold text-xl">Start the conversation</h3>
                      <p className="text-zinc-500 max-w-xs">Our AI agent is ready to qualify this lead and book a call.</p>
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <motion.div 
                    key={m.id || i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex",
                      m.role === 'user' ? "justify-end" : "justify-start"
                    )}
                  >
                    <div className={cn(
                      "max-w-[80%] p-4 rounded-3xl text-sm leading-relaxed",
                      m.role === 'user' 
                        ? "bg-white text-black rounded-tr-none" 
                        : "bg-zinc-900 text-white border border-zinc-800 rounded-tl-none"
                    )}>
                      {m.content}
                      <div className={cn(
                        "text-[10px] mt-2 opacity-50 font-mono",
                        m.role === 'user' ? "text-right" : "text-left"
                      )}>
                        {format(new Date(m.timestamp), 'h:mm a')}
                      </div>
                    </div>
                  </motion.div>
                ))}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-zinc-900 p-4 rounded-3xl rounded-tl-none border border-zinc-800">
                      <div className="flex space-x-1">
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <footer className="p-6 bg-[#050505] border-t border-zinc-800">
                <form onSubmit={sendMessage} className="relative">
                  <input 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a message..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:border-orange-500 transition-colors"
                  />
                  <button 
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    className="absolute right-2 top-2 bottom-2 px-4 bg-white text-black rounded-xl font-bold hover:bg-orange-500 hover:text-white transition-all disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-black"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
