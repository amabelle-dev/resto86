import React, { useEffect, useMemo, useState, useRef } from "react";
import { Bell, Clock, History, LogOut, Search, Settings, Shield, User, X, CheckCircle2, CloudLightning, Sparkles, Wand2, MessageSquareText } from "lucide-react";
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

/**
 * RESTO 86 - CLOUD EDITION
 * Production Ready Version (Fixed TS Build Errors)
 */

// Declare globals for TypeScript compiler
declare global {
  interface Window {
    __firebase_config?: string;
    __app_id?: string;
    __initial_auth_token?: string;
  }
}

// Access globals safely for different environments
const _env_config = typeof window !== 'undefined' ? window.__firebase_config : undefined;
const _env_app_id = typeof window !== 'undefined' ? window.__app_id : undefined;
const _env_token = typeof window !== 'undefined' ? window.__initial_auth_token : undefined;

// ----- Firebase Setup -----
const fallbackConfig = {
  apiKey: "AIzaSyAL59l8UZWeAy2aWUcLF02iayVpN33N6kA", 
  authDomain: "resto-86.firebaseapp.com",
  projectId: "resto-86",
  storageBucket: "resto-86.firebasestorage.app",
  messagingSenderId: "1001709197843",
  appId: "1:1001709197843:web:3f0fcfb7c62d7a4eca3de6",
  measurementId: "G-Z9NQT0HB95"
};

const firebaseConfig = _env_config ? JSON.parse(_env_config) : fallbackConfig;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = _env_app_id || "resto-86-production";

// ----- Seed data -----
const DEFAULT_BRANCHES = ["Bin Mahmoud", "Lusail", "Wakra"];
const DEFAULT_ITEMS = [
  [1, "Chicken Wings", "Mains"],
  [2, "Beef Burger", "Mains"],
  [3, "Chicken Burger", "Mains"],
  [4, "Fries", "Sides"],
  [5, "Nachos", "Sides"],
  [6, "Mojito", "Drinks"],
  [7, "Iced Tea", "Drinks"],
  [8, "Pasta", "Mains"],
  [9, "Cheese Sauce", "Sauces"],
  [10, "Dumplings", "Mains"],
].map(([id, name, category]) => ({ id: id as number, name: name as string, category: category as string }));

const STATUS = {
  available: { label: "AVAILABLE", card: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
  soldout: { label: "86", card: "bg-rose-50 border-rose-200", text: "text-rose-700", dot: "bg-rose-500" },
};

const SESSION_KEY = "resto86_session_cloud_v1";
const MAX_HISTORY = 500;

// ----- Gemini API Integration -----
const callGemini = async (prompt: string) => {
  const apiKey = ""; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };

  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("API Error");
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (err) {
      if (i === 4) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  return "";
};

// ----- Helpers -----
const nowISO = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
const cn = (...a: any[]) => a.filter(Boolean).join(" ");

const fmtWithSec = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const spanShort = (ms: number) => {
  const safe = Math.max(0, ms);
  const m = Math.floor(safe / 60000);
  if (safe > 0 && m === 0) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d${remH}h` : `${d}d`;
};

const sinceShort = (iso: string) => spanShort(Date.now() - new Date(iso).getTime());
const durationShort = (startIso: string, endIso: string) => (!startIso || !endIso ? "—" : spanShort(new Date(endIso).getTime() - new Date(startIso).getTime()));

const copyToClipboard = (text: string, onSuccess?: () => void, onFail?: () => void) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    if (onSuccess) onSuccess();
  } catch (err) {
    if (onFail) onFail();
  }
  document.body.removeChild(textArea);
};

// ----- State builders -----
function buildDefaultState() {
  const t = nowISO();
  const statuses = Object.fromEntries(
    DEFAULT_BRANCHES.map((b: string) => [
      b,
      Object.fromEntries(
        DEFAULT_ITEMS.map((it: any) => [
          it.id,
          { status: "available", note: "", updatedAt: t, updatedBy: "System", ack: { done: true, at: t, by: "System" } },
        ])
      ),
    ])
  );

  return {
    branches: DEFAULT_BRANCHES,
    items: DEFAULT_ITEMS,
    customCategories: [],
    statuses,
    history: [],
    accounts: {
      admin: { pin: "1234" },
      agent: { pin: "1234" },
      branches: Object.fromEntries(DEFAULT_BRANCHES.map((b) => [b, { pin: "1234" }])),
    },
  };
}

function normalizeState(raw: any) {
  const base = buildDefaultState();
  const merged = { ...base, ...(raw || {}) };
  const branches = Array.isArray(merged.branches) && merged.branches.length ? merged.branches : DEFAULT_BRANCHES;
  const items = Array.isArray(merged.items) && merged.items.length ? merged.items : DEFAULT_ITEMS;
  const t = nowISO();

  const statuses = { ...(merged.statuses || {}) };
  branches.forEach((b: string) => {
    statuses[b] = statuses[b] || {};
    items.forEach((it: any) => {
      const cur = statuses[b][it.id] || { status: "available", note: "", updatedAt: t, updatedBy: "System" };
      if (!cur.ack) cur.ack = { done: true, at: cur.updatedAt || t, by: cur.updatedBy || "System" };
      statuses[b][it.id] = cur;
    });
  });

  const branchAcc = (merged.accounts || {}).branches || {};
  branches.forEach((b: string) => { if (!branchAcc[b]) branchAcc[b] = { pin: "1234" }; });
  Object.keys(branchAcc).forEach((b: string) => { if (!branches.includes(b)) delete branchAcc[b]; });

  return {
    ...merged,
    branches,
    items,
    customCategories: Array.isArray(merged.customCategories) ? merged.customCategories : [],
    statuses,
    history: Array.isArray(merged.history) ? merged.history.slice(0, MAX_HISTORY) : [],
    accounts: {
      admin: { pin: String(merged.accounts?.admin?.pin || "1234") },
      agent: { pin: String(merged.accounts?.agent?.pin || "1234") },
      branches: branchAcc,
    },
  };
}

// ----- Reusable UI Components -----
const Modal = ({ open, title, onClose, children, max = "max-w-md" }: any) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className={cn("w-full bg-white rounded-2xl shadow-xl p-5 animate-in zoom-in-95 duration-200", max)}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const SearchInput = ({ value, onChange, placeholder }: any) => (
  <div className="flex items-center gap-2 border border-slate-200 bg-white rounded-xl px-3 py-2 focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100 transition-all flex-1">
    <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
    <input 
      value={value} 
      onChange={(e) => onChange(e.target.value)} 
      className="bg-transparent outline-none text-sm w-full placeholder-slate-400" 
      placeholder={placeholder} 
    />
    {value && (
      <button onClick={() => onChange("")} className="text-slate-400 hover:text-slate-600 focus:outline-none flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
);

function RoleBadge({ session }: any) {
  if (!session) return null;
  const config = {
    admin: { bg: "bg-slate-900", icon: Shield, text: "Admin" },
    agent: { bg: "bg-indigo-600", icon: User, text: "Agent" },
    branch: { bg: "bg-emerald-600", icon: User, text: session.branch }
  }[session.role === "branch" ? "branch" : (session.role as "admin" | "agent")];

  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl text-white font-medium shadow-sm", config.bg)}>
      <Icon className="w-3.5 h-3.5" /> {config.text}
    </span>
  );
}

// ----- Main App -----
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [localData, setLocalData] = useState<any>(null);
  const [isDbLoading, setIsDbLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null); 
  
  const latestDataRef = useRef<any>(null);

  const [session, setSession] = useState<any>(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });

  const [activeTab, setActiveTab] = useState("staff");
  const [selectedBranch, setSelectedBranch] = useState(DEFAULT_BRANCHES[0]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [noteModal, setNoteModal] = useState<any>({ open: false, branch: "", item: null, value: "", error: "" });
  const [nowTick, setNowTick] = useState(Date.now());

  // Filters
  const [staffSearch, setStaffSearch] = useState("");
  const [staffCategory, setStaffCategory] = useState("All");
  const [staffStatusFilter, setStaffStatusFilter] = useState("All");

  const [agentBranchFilter, setAgentBranchFilter] = useState("All");
  const [agentCategoryFilter, setAgentCategoryFilter] = useState("All");
  const [agentSearch, setAgentSearch] = useState("");
  const [agentStatusFilter, setAgentStatusFilter] = useState("soldout");
  const [agentPendingOnly, setAgentPendingOnly] = useState(true);

  const [historySearch, setHistorySearch] = useState("");
  const [historyBranchFilter, setHistoryBranchFilter] = useState("All");
  const [historyTypeFilter, setHistoryTypeFilter] = useState("All");

  // Gemini State
  const [isGeneratingReason, setIsGeneratingReason] = useState(false);
  const [apologyModal, setApologyModal] = useState<any>({ open: false, item: null, text: "", loading: false });
  const [insights, setInsights] = useState<any>({ text: "", loading: false });

  // Settings Forms
  const [adminPin, setAdminPin] = useState("1234");
  const [agentPin, setAgentPin] = useState("1234");
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchPin, setNewBranchPin] = useState("1234");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Mains");
  const [menuSearch, setMenuSearch] = useState("");
  const [menuCategoryFilter, setMenuCategoryFilter] = useState("All");

  // 1. Authenticate to Firebase
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (_env_token) {
          await signInWithCustomToken(auth, _env_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error: any) {
        console.error("Auth Error:", error);
        if (error.message && error.message.includes('api-key-not-valid')) {
           setDbError("Invalid API Key! Please check your code.");
        } else {
           setDbError("Authentication failed! Please make sure you enabled 'Anonymous' sign-in in Firebase.");
        }
        setIsDbLoading(false);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Sync Global Data from Firestore
  useEffect(() => {
    if (!user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'resto86', 'globalState');
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const d = normalizeState(docSnap.data());
        setLocalData(d);
        latestDataRef.current = d;
      } else {
        const defaultData = buildDefaultState();
        setDoc(docRef, defaultData); 
        setLocalData(defaultData);
        latestDataRef.current = defaultData;
      }
      setIsDbLoading(false);
      setDbError(null);
    }, (err) => {
      console.error("Firestore error:", err);
      setDbError("Database access denied! Please make sure you updated your Firestore Rules.");
      setIsDbLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Session persistence
  useEffect(() => {
    try {
      if (!session) window.localStorage.removeItem(SESSION_KEY);
      else window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {}
  }, [session]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const updateData = async (updater: any) => {
    if (!latestDataRef.current) return;
    const newState = typeof updater === 'function' ? updater(latestDataRef.current) : updater;
    
    setLocalData(newState);
    latestDataRef.current = newState;

    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'resto86', 'globalState');
      await setDoc(docRef, newState);
    } catch (err) {
      console.error(err);
      showToast("Error saving to cloud");
    }
  };

  const data = localData || buildDefaultState();

  useEffect(() => {
    if (!session) return;
    if (session.role === "branch") { setSelectedBranch(session.branch); setActiveTab("staff"); }
    if (session.role === "agent") setActiveTab("agent");
    if (session.role === "admin") {
      setActiveTab("settings");
      setAdminPin(data.accounts?.admin?.pin || "1234");
      setAgentPin(data.accounts?.agent?.pin || "1234");
    }
  }, [session, data.accounts]);

  const qMatch = (q: string, ...vals: any[]) => !q || vals.some((v) => String(v || "").toLowerCase().includes(q));
  const categories = useMemo(() => ["All", ...Array.from(new Set([...(data.customCategories || []), ...(data.items || []).map((i: any) => i.category)]))], [data.items, data.customCategories]);
  const effectiveBranch = session?.role === "branch" ? session.branch : selectedBranch;

  // Memoized Rows
  const staffRows = useMemo(() => {
    void nowTick;
    const q = staffSearch.trim().toLowerCase();
    return (data.items || [])
      .filter((i: any) => qMatch(q, i.name, i.category))
      .filter((i: any) => (staffCategory === "All" ? true : i.category === staffCategory))
      .filter((i: any) => staffStatusFilter === "All" || data.statuses?.[effectiveBranch]?.[i.id]?.status === staffStatusFilter);
  }, [data.items, data.statuses, effectiveBranch, staffSearch, staffCategory, staffStatusFilter, nowTick]);

  const agentRows = useMemo(() => {
    void nowTick;
    const q = agentSearch.trim().toLowerCase();
    return (data.branches || []).flatMap((branch: string) =>
      (data.items || []).map((item: any) => ({ branch, item, ...(data.statuses?.[branch]?.[item.id] || {}) }))
    )
    .filter((r: any) => r.status)
    .filter((r: any) => agentBranchFilter === "All" || r.branch === agentBranchFilter)
    .filter((r: any) => agentCategoryFilter === "All" || r.item.category === agentCategoryFilter)
    .filter((r: any) => agentStatusFilter === "All" || r.status === agentStatusFilter)
    .filter((r: any) => qMatch(q, r.item.name, r.item.category, r.branch, r.note))
    .filter((r: any) => !agentPendingOnly || !(r.ack && r.ack.done))
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [data, agentSearch, agentBranchFilter, agentCategoryFilter, agentStatusFilter, agentPendingOnly, nowTick]);

  const historyRows = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return (data.history || [])
      .filter((h: any) => historyBranchFilter === "All" || h.branch === historyBranchFilter)
      .filter((h: any) => historyTypeFilter === "All" || h.type === historyTypeFilter)
      .filter((h: any) => qMatch(q, h.branch, h.itemName, h.by, h.note));
  }, [data.history, historySearch, historyBranchFilter, historyTypeFilter]);

  const summary = useMemo(() => {
    let soldout = 0, available = 0;
    (data.branches || []).forEach((b: string) => (data.items || []).forEach((i: any) => (data.statuses?.[b]?.[i.id]?.status === "soldout" ? soldout++ : available++)));
    return { soldout, available };
  }, [data]);

  const pushHistory = (entry: any) => updateData((p: any) => ({ ...p, history: [entry, ...(p.history || [])].slice(0, MAX_HISTORY) }));

  // ----- Gemini Actions -----
  const handleAutoReason = async () => {
    if (!noteModal.item) return;
    setIsGeneratingReason(true);
    try {
      const prompt = `You are an AI for a restaurant dashboard. The item "${noteModal.item.name}" (Category: ${noteModal.item.category}) is being marked as "86" (sold out). Provide a short, professional, realistic 1-sentence reason why it might be sold out (e.g., ingredient shortage, delivery delay, equipment issue). Do not use quotes. Limit to 10 words.`;
      const text = await callGemini(prompt);
      setNoteModal((prev: any) => ({ ...prev, value: text.trim(), error: "" }));
    } catch (error) {
      showToast("Failed to generate reason");
    }
    setIsGeneratingReason(false);
  };

  const handleGenerateApology = async (item: any, branch: string) => {
    setApologyModal({ open: true, item, text: "", loading: true });
    try {
      const prompt = `Write a short, polite 2-sentence apology to a customer because their ordered item "${item.name}" is currently sold out at our ${branch} branch. Suggest they choose an alternative. Keep it professional and empathetic.`;
      const text = await callGemini(prompt);
      setApologyModal((prev: any) => ({ ...prev, text: text.trim(), loading: false }));
    } catch (error) {
      setApologyModal((prev: any) => ({ ...prev, text: "Error generating apology. Please try again.", loading: false }));
    }
  };

  const handleGenerateInsights = async () => {
    setInsights((prev: any) => ({ ...prev, loading: true }));
    try {
      const recentHistory = data.history.slice(0, 50).map((h: any) => `${h.type} on ${h.itemName} at ${h.branch} (${h.note})`);
      const prompt = `Analyze this recent restaurant menu availability history: ${JSON.stringify(recentHistory)}. Identify which items frequently go out of stock, which branches struggle the most, and provide 2-3 actionable inventory recommendations. Format with short bullet points. Do not use markdown headers, just plain text with bullets.`;
      const text = await callGemini(prompt);
      setInsights({ text: text.trim(), loading: false });
    } catch (error) {
      setInsights({ text: "Failed to generate insights. Ensure you have enough history data.", loading: false });
      showToast("Insight generation failed");
    }
  };

  // ----- Actions -----
  const setStatus = (branch: string, item: any, nextStatus: string, note = "") => {
    const actor = session?.role === "branch" ? `Staff (${branch})` : session?.role === "admin" ? "Admin" : "System";
    const t = nowISO();

    updateData((p: any) => {
      const prevRec = p.statuses?.[branch]?.[item.id];
      if (!prevRec) return p;
      const nextRec = { ...prevRec, status: nextStatus, note, updatedAt: t, updatedBy: actor, ack: { done: false, at: null, by: null } };
      return { ...p, statuses: { ...p.statuses, [branch]: { ...p.statuses[branch], [item.id]: nextRec } } };
    });

    pushHistory({ id: uid(), type: "status", branch, itemId: item.id, itemName: item.name, note: `${(STATUS as any)[data.statuses?.[branch]?.[item.id]?.status]?.label || ""} → ${(STATUS as any)[nextStatus]?.label}${note ? ` • ${note}` : ""}`, at: t, by: actor, duration: durationShort(data.statuses?.[branch]?.[item.id]?.updatedAt, t) });
    showToast(nextStatus === "soldout" ? `${branch}: ${item.name} marked 86` : `${branch}: ${item.name} restored`);
  };

  const cycleStatus = (branch: string, item: any) => {
    const rec = data.statuses?.[branch]?.[item.id];
    if (!rec) return;
    if (rec.status === "soldout") setStatus(branch, item, "available", "");
    else setNoteModal({ open: true, branch, item, value: rec.note || "", error: "" });
  };

  const saveNote = (e?: any) => {
    if (e) e.preventDefault();
    if (!noteModal.item) return;
    const v = (noteModal.value || "").trim();
    if (!v) return setNoteModal((m: any) => ({ ...m, error: "Reason is required when marking 86." }));
    setStatus(noteModal.branch, noteModal.item, "soldout", v);
    setNoteModal({ open: false, branch: "", item: null, value: "", error: "" });
  };

  const confirmAck = (branch: string, itemId: number) => {
    const actor = "Agent";
    const t = nowISO();
    updateData((p: any) => {
      const rec = p.statuses?.[branch]?.[itemId];
      if (!rec) return p;
      return { ...p, statuses: { ...p.statuses, [branch]: { ...p.statuses[branch], [itemId]: { ...rec, ack: { done: true, at: t, by: actor } } } } };
    });
    pushHistory({ id: uid(), type: "ack", branch, itemId, itemName: data.items.find((x: any) => x.id === itemId)?.name || "Item", note: "Confirmed platform sync", at: t, by: actor, duration: "—" });
  };

  // ----- Render: Loading & Error States -----
  if (isDbLoading && !dbError) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 bg-white rounded-2xl shadow-md flex items-center justify-center mb-6">
          <CloudLightning className="w-8 h-8 text-indigo-600 animate-pulse" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Connecting to Cloud...</h2>
        <p className="text-sm text-slate-500 mt-2 font-medium">Synchronizing real-time databases</p>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center border-t-4 border-rose-500">
          <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-6 h-6 text-rose-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Connection Blocked</h2>
          <p className="text-sm text-slate-600 mb-6">{dbError}</p>
        </div>
      </div>
    );
  }

  // ----- Render: Login -----
  if (!session) {
    const submitLogin = (mode: string, branch: string, pin: string, setError: any) => {
      setError("");
      const p = pin.trim();
      if (!p) return setError("Enter PIN");
      if (mode === "branch") {
        if (p !== String(data.accounts?.branches?.[branch]?.pin || "")) return setError("Wrong PIN");
        setSession({ role: "branch", branch });
      } else if (mode === "agent") {
        if (p !== String(data.accounts?.agent?.pin || "")) return setError("Wrong PIN");
        setSession({ role: "agent" });
      } else {
        if (p !== String(data.accounts?.admin?.pin || "")) return setError("Wrong PIN");
        setSession({ role: "admin" });
      }
    };

    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
        <LoginScreen branches={data.branches || []} onSubmit={submitLogin} />
      </div>
    );
  }

  // ----- Render: Dashboard -----
  const showStaff = session.role === "branch" || session.role === "admin";
  const showAgent = session.role === "agent" || session.role === "admin";
  const showHistory = session.role === "agent" || session.role === "admin";
  const showInsights = session.role === "admin";
  const showSettings = session.role === "admin";

  const TabBtn = ({ id, label, icon }: any) => (
    <button type="button" onClick={() => setActiveTab(id)} className={cn("px-4 py-2.5 rounded-xl text-sm border inline-flex items-center gap-2 font-medium transition-all", activeTab === id ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50")}>
      {icon} {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-6 font-sans pb-24">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Resto 86 Dashboard</h1>
                <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-[10px] uppercase font-bold px-2 py-0.5 rounded-md border border-indigo-100"><CloudLightning className="w-3 h-3"/> Cloud Sync</span>
              </div>
              <p className="text-sm text-slate-500">Real-time menu availability sync</p>
            </div>
            <div className="flex items-center gap-3">
              <RoleBadge session={session} />
              <button type="button" onClick={() => setConfirmLogoutOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium transition-colors shadow-sm">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[["86 Items", summary.soldout, "rose"], ["Available Items", summary.available, "emerald"]].map(([label, value, c]) => (
              <div key={label as string} className={cn("rounded-xl border p-4 shadow-sm", c === "rose" ? "border-rose-200 bg-rose-50/50" : "border-emerald-200 bg-emerald-50/50")}>
                <div className={cn("text-xs font-semibold uppercase tracking-wider mb-1", c === "rose" ? "text-rose-700" : "text-emerald-700")}>{label as string}</div>
                <div className={cn("text-3xl font-bold", c === "rose" ? "text-rose-700" : "text-emerald-700")}>{value as number}</div>
              </div>
            ))}
          </div>
        </header>

        {/* Navigation */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {showStaff && <TabBtn id="staff" label="Staff View" icon={<User className="w-4 h-4" />} />}
          {showAgent && <TabBtn id="agent" label="Agent Window" icon={<Clock className="w-4 h-4" />} />}
          {showHistory && <TabBtn id="history" label="History Logs" icon={<History className="w-4 h-4" />} />}
          {showInsights && <TabBtn id="insights" label="AI Insights" icon={<Sparkles className="w-4 h-4 text-indigo-500" />} />}
          {showSettings && <TabBtn id="settings" label="Settings" icon={<Settings className="w-4 h-4" />} />}
        </div>

        {/* STAFF TAB */}
        {activeTab === "staff" && showStaff && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-5 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:gap-4 mb-5">
              <div className="flex-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Branch</label>
                {session.role === "admin" ? (
                  <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white h-10">
                    {(data.branches || []).map((b: string) => <option key={b}>{b}</option>)}
                  </select>
                ) : (
                  <div className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-slate-50 text-slate-700 font-medium h-10 flex items-center">{session.branch}</div>
                )}
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Category</label>
                <select value={staffCategory} onChange={(e) => setStaffCategory(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white h-10">
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Status</label>
                <select value={staffStatusFilter} onChange={(e) => setStaffStatusFilter(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white h-10">
                  <option value="All">All Items</option>
                  <option value="available">Available</option>
                  <option value="soldout">86 Only</option>
                </select>
              </div>
              <div className="flex-[2]">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Search</label>
                <SearchInput value={staffSearch} onChange={setStaffSearch} placeholder="Find menu items..." />
              </div>
            </div>

            <div className="grid gap-3 max-h-[60vh] overflow-y-auto pr-1">
              {staffRows.map((item: any) => {
                const rec = data.statuses?.[effectiveBranch]?.[item.id];
                if (!rec) return null;
                const is86 = rec.status === "soldout";
                const ack = rec.ack || { done: false };

                return (
                  <div key={item.id} className={cn("border rounded-xl p-4 transition-colors shadow-sm", (STATUS as any)[rec.status].card)}>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-bold text-base md:text-lg text-slate-900">{item.name}</div>
                        <div className="text-sm text-slate-600 mt-1">
                          <span className="font-medium">{item.category}</span> • {is86 ? `Marked ${sinceShort(rec.updatedAt)} ago` : `Available`} • <span className="text-slate-500">{rec.updatedBy}</span>
                        </div>
                        {rec.note && <div className="text-sm font-medium text-slate-700 mt-2 bg-white/60 inline-block px-2.5 py-1 rounded-md border border-slate-200/50">Reason: {rec.note}</div>}
                        <div className="mt-3 flex items-center gap-2">
                          <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1", ack.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800")}>
                            {ack.done ? <><CheckCircle2 className="w-3.5 h-3.5" /> Confirmed ({ack.by || "Agent"})</> : "Pending confirmation"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end md:self-auto mt-2 md:mt-0">
                        <div className={cn("px-4 py-2.5 rounded-xl border bg-white min-w-[120px] text-center shadow-sm", is86 ? "border-rose-200" : "border-emerald-200")}>
                          <div className="flex items-center justify-center gap-2">
                            <span className={cn("w-2.5 h-2.5 rounded-full", (STATUS as any)[rec.status].dot, is86 && "animate-pulse")} />
                            <span className={cn("text-sm font-bold tracking-wide", (STATUS as any)[rec.status].text)}>{(STATUS as any)[rec.status].label}</span>
                          </div>
                        </div>

                        <button 
                          type="button" 
                          onClick={() => cycleStatus(effectiveBranch, item)} 
                          className={cn("relative inline-flex h-10 w-20 items-center rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 shrink-0", is86 ? "bg-rose-100 border-rose-400 focus:ring-rose-500" : "bg-emerald-100 border-emerald-400 focus:ring-emerald-500")}
                        >
                          <span className={cn("inline-block h-8 w-8 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out", is86 ? "translate-x-10" : "translate-x-1")} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {staffRows.length === 0 && (
                <div className="text-center py-12 px-4 text-slate-500 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center">
                  <Search className="w-8 h-8 text-slate-300 mb-3" />
                  <p className="font-medium text-slate-600">No items found</p>
                  <p className="text-sm mt-1">Try adjusting your filters or search term.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* AGENT TAB */}
        {activeTab === "agent" && showAgent && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-5 space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <select value={agentBranchFilter} onChange={(e) => setAgentBranchFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                {["All Branches", ...(data.branches || [])].map((b: string) => <option key={b} value={b === "All Branches" ? "All" : b}>{b}</option>)}
              </select>
              <select value={agentCategoryFilter} onChange={(e) => setAgentCategoryFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
              <div className="col-span-2 lg:col-span-2 flex">
                <SearchInput value={agentSearch} onChange={setAgentSearch} placeholder="Search anything..." />
              </div>
              <select value={agentStatusFilter} onChange={(e) => setAgentStatusFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                <option value="All">All Statuses</option>
                <option value="soldout">86 Only</option>
                <option value="available">Available Only</option>
              </select>
              <label className="inline-flex items-center justify-center gap-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors col-span-2 lg:col-span-1">
                <input type="checkbox" checked={agentPendingOnly} onChange={(e) => setAgentPendingOnly(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" /> 
                Pending
              </label>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
              <table className="w-full text-sm text-left whitespace-nowrap md:whitespace-normal">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-4 font-semibold">Branch</th>
                    <th className="p-4 font-semibold">Item & Details</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {agentRows.map((r: any) => {
                    const ack = r.ack || { done: false };
                    return (
                      <tr key={`${r.branch}-${r.item.id}`} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-medium text-slate-900">{r.branch}</td>
                        <td className="p-4">
                          <div className="font-bold text-slate-900 text-base">{r.item.name}</div>
                          <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-2 items-center">
                            <span className="bg-slate-100 px-2 py-0.5 rounded-md">{r.item.category}</span>
                            <span>{r.status === "soldout" ? `Marked 86 ${sinceShort(r.updatedAt)} ago` : `Available ${sinceShort(r.updatedAt)} ago`}</span>
                          </div>
                          {r.note && <div className="text-sm text-slate-600 mt-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">Reason: {r.note}</div>}
                        </td>
                        <td className="p-4 align-top">
                          <span className={cn("px-3 py-1.5 rounded-lg text-xs font-bold inline-block border", r.status === "soldout" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-emerald-50 text-emerald-700 border-emerald-200")}>
                            {(STATUS as any)[r.status].label}
                          </span>
                        </td>
                        <td className="p-4 align-top text-center min-w-[140px]">
                          <button
                            type="button"
                            onClick={() => confirmAck(r.branch, r.item.id)}
                            disabled={!!ack.done}
                            className={cn(
                              "w-full px-4 py-2 rounded-xl text-xs font-bold border transition-all shadow-sm flex items-center justify-center gap-1.5",
                              ack.done ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed" : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500"
                            )}
                          >
                            {ack.done ? <><CheckCircle2 className="w-3.5 h-3.5" /> Confirmed</> : "Confirm Sync"}
                          </button>
                          {ack.done && ack.at && <div className="text-[11px] text-slate-400 mt-2 font-medium">By {ack.by || "Agent"}<br/>{fmtWithSec(ack.at)}</div>}
                          {r.status === "soldout" && (
                            <button
                              type="button"
                              onClick={() => handleGenerateApology(r.item, r.branch)}
                              className="w-full mt-2 px-3 py-1.5 rounded-xl text-[11px] font-bold border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                            >
                              <MessageSquareText className="w-3.5 h-3.5" /> Draft Apology ✨
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!agentRows.length && (
                    <tr>
                      <td className="p-12 text-center text-slate-500 text-sm" colSpan={4}>
                         <CheckCircle2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                         No pending updates to confirm.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && showHistory && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-5 space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2 flex">
                <SearchInput value={historySearch} onChange={setHistorySearch} placeholder="Search history logs..." />
              </div>
              <select value={historyBranchFilter} onChange={(e) => setHistoryBranchFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                {["All Branches", ...(data.branches || [])].map((b: string) => <option key={b} value={b === "All Branches" ? "All" : b}>{b}</option>)}
              </select>
              <select value={historyTypeFilter} onChange={(e) => setHistoryTypeFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                <option value="All">All Events</option>
                <option value="status">Status Changes</option>
                <option value="ack">Platform Syncs</option>
              </select>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5 font-semibold">Date/Time</th>
                    <th className="p-3.5 font-semibold">Branch</th>
                    <th className="p-3.5 font-semibold">Item</th>
                    <th className="p-3.5 font-semibold">Event</th>
                    <th className="p-3.5 font-semibold">Details</th>
                    <th className="p-3.5 font-semibold">User</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {historyRows.map((h: any) => (
                    <tr key={h.id} className={cn("hover:bg-slate-50 transition-colors", h.type === "ack" && "bg-indigo-50/20")}>
                      <td className="p-3.5 text-xs text-slate-500">{fmtWithSec(h.at)}</td>
                      <td className="p-3.5 font-medium text-slate-900">{h.branch}</td>
                      <td className="p-3.5 font-bold text-slate-700">{h.itemName}</td>
                      <td className="p-3.5">
                        <span className={cn("px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider", h.type === "status" ? "bg-slate-100 text-slate-600" : "bg-indigo-100 text-indigo-700")}>{h.type}</span>
                      </td>
                      <td className="p-3.5 text-sm text-slate-700 max-w-[200px] truncate" title={h.note}>{h.note || "—"}</td>
                      <td className="p-3.5 text-xs font-medium text-slate-600">{h.by || "—"}</td>
                    </tr>
                  ))}
                  {!historyRows.length && (
                    <tr><td className="p-8 text-center text-slate-500 text-sm" colSpan={6}>No history records match criteria</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* INSIGHTS TAB */}
        {activeTab === "insights" && showInsights && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="max-w-3xl mx-auto">
              <div className="text-center space-y-3 mb-8">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto border border-indigo-100">
                  <Sparkles className="w-8 h-8 text-indigo-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">AI Menu Insights</h2>
                <p className="text-slate-500">Analyze your recent 86 history to find patterns and inventory recommendations powered by Gemini.</p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 shadow-inner min-h-[250px] flex flex-col">
                {insights.loading ? (
                  <div className="flex flex-col items-center justify-center flex-1 space-y-4 py-12">
                    <Wand2 className="w-8 h-8 text-indigo-500 animate-spin" style={{ animationDuration: '3s' }} />
                    <p className="text-sm font-medium text-slate-500 animate-pulse">Analyzing stock history across branches...</p>
                  </div>
                ) : insights.text ? (
                  <div className="flex-1 whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
                    {insights.text}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 text-center py-12">
                    <p className="text-slate-400 mb-4 text-sm">No analysis generated yet.</p>
                  </div>
                )}
              </div>
              
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={handleGenerateInsights}
                  disabled={insights.loading}
                  className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className="w-5 h-5" />
                  {insights.text ? "Regenerate Insights" : "Generate Insights"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && showSettings && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-in fade-in slide-in-from-bottom-2">
            
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Security</h3>
                <p className="text-xs text-slate-500 mt-0.5">Manage master access PINs.</p>
              </div>
              <form onSubmit={(e: any) => { e.preventDefault(); const a = adminPin.trim(); const g = agentPin.trim(); if(!a||!g) return showToast("Pins required"); updateData((p: any) => ({...p, accounts: {...p.accounts, admin: {pin:a}, agent: {pin:g}}})); showToast("Security PINs updated"); }} className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1.5">Admin PIN</label>
                    <input value={adminPin} onChange={(e) => setAdminPin(e.target.value)} type="text" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1.5">Agent PIN</label>
                    <input value={agentPin} onChange={(e) => setAgentPin(e.target.value)} type="text" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all" />
                  </div>
                </div>
                <button type="submit" className="w-full px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors">Save Security Settings</button>
              </form>
              <div className="mt-auto p-3 bg-indigo-50 rounded-xl border border-indigo-100 flex items-start gap-2">
                <CloudLightning className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-indigo-800 font-medium">All data is securely synced to the cloud. You can safely clear your browser cache.</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Locations</h3>
                <p className="text-xs text-slate-500 mt-0.5">Manage branches and login PINs.</p>
              </div>
              <form onSubmit={(e: any) => { e.preventDefault(); const n = newBranchName.trim(); const p = newBranchPin.trim() || "1234"; if(!n) return; if(data.branches.some((b: string) => b.toLowerCase() === n.toLowerCase())) return showToast("Branch exists"); const t = nowISO(); updateData((pr: any) => ({...pr, branches: [...pr.branches, n], statuses: {...pr.statuses, [n]: Object.fromEntries(pr.items.map((i: any) => [i.id, {status:"available", note:"", updatedAt:t, updatedBy:"Admin", ack:{done:true,at:t,by:"Admin"}}]))}, accounts: {...pr.accounts, branches: {...pr.accounts.branches, [n]: {pin: p}}}})); setNewBranchName(""); setNewBranchPin("1234"); showToast(`Branch ${n} added`); }} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <input value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all bg-white" placeholder="Branch name" required />
                <div className="flex gap-2">
                  <input value={newBranchPin} onChange={(e) => setNewBranchPin(e.target.value)} className="w-1/2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all bg-white" placeholder="PIN (Default 1234)" />
                  <button type="submit" className="w-1/2 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors">Add Branch</button>
                </div>
              </form>
              <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                {(data.branches || []).map((b: string) => (
                  <div key={b} className="border border-slate-200 rounded-xl p-3 bg-white shadow-sm flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-slate-900">{b}</div>
                      <button type="button" onClick={() => { if(data.branches.length <= 1) return showToast("Need at least 1 branch"); updateData((p: any) => { const nb = p.branches.filter((x: string) => x !== b); const ns = {...p.statuses}; delete ns[b]; const na = {...p.accounts.branches}; delete na[b]; return {...p, branches: nb, statuses: ns, accounts: {...p.accounts, branches: na}}}); showToast("Branch deleted"); }} className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors">Remove</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-slate-500 w-8">PIN:</div>
                      <input defaultValue={data.accounts?.branches?.[b]?.pin || "1234"} onBlur={(e: any) => { const p = e.target.value.trim(); if(p) { updateData((prev: any) => ({...prev, accounts: {...prev.accounts, branches: {...prev.accounts.branches, [b]: {pin: p}}}})); showToast("Branch PIN saved"); } }} className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all bg-slate-50" placeholder="Set PIN" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Menu Master</h3>
                <p className="text-xs text-slate-500 mt-0.5">Manage global menu items & categories.</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
                <form onSubmit={(e: any) => { e.preventDefault(); const n = newCategoryName.trim(); if(!n) return; if(categories.some(c => c.toLowerCase() === n.toLowerCase())) return showToast("Exists"); updateData((p: any) => ({...p, customCategories: [...p.customCategories, n]})); setNewCategoryName(""); setNewItemCategory(n); showToast("Category added"); }} className="flex gap-2">
                  <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all bg-white" placeholder="Add category..." />
                  <button type="submit" className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-semibold transition-colors">Add</button>
                </form>

                <div className="h-px bg-slate-200 w-full" />

                <form onSubmit={(e: any) => { e.preventDefault(); const n = newItemName.trim(); if(!n) return; const id = Math.max(0, ...data.items.map((i: any) => i.id)) + 1; const t = nowISO(); updateData((p: any) => ({...p, items: [...p.items, {id, name:n, category:newItemCategory}], customCategories: p.customCategories.includes(newItemCategory) ? p.customCategories : [...p.customCategories, newItemCategory], statuses: Object.fromEntries(p.branches.map((b: string) => [b, {...p.statuses[b], [id]: {status:"available", note:"", updatedAt:t, updatedBy:"Admin", ack:{done:true,at:t,by:"Admin"}}}]))})); setNewItemName(""); showToast("Item added"); }} className="flex flex-col gap-2">
                  <input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all bg-white" placeholder="New item name..." required />
                  <div className="flex gap-2">
                    <select value={newItemCategory} onChange={(e) => setNewItemCategory(e.target.value)} className="w-1/2 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                      {categories.filter((c) => c !== "All").map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <button type="submit" className="w-1/2 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors">Add Item</button>
                  </div>
                </form>
              </div>

              <div className="flex gap-2">
                <select value={menuCategoryFilter} onChange={(e) => setMenuCategoryFilter(e.target.value)} className="w-1/3 rounded-xl border border-slate-200 px-2 py-2 text-sm outline-none focus:border-slate-400 bg-white">
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
                <div className="w-2/3 flex"><SearchInput value={menuSearch} onChange={setMenuSearch} placeholder="Filter menu..." /></div>
              </div>

              <div className="space-y-2 max-h-[35vh] overflow-y-auto pr-1">
                {(data.items || [])
                  .filter((i: any) => menuCategoryFilter === "All" || i.category === menuCategoryFilter)
                  .filter((i: any) => qMatch(menuSearch.trim().toLowerCase(), i.name, i.category))
                  .sort((a: any, b: any) => a.name.localeCompare(b.name))
                  .map((it: any) => (
                    <div key={it.id} className="border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 bg-white hover:bg-slate-50 transition-colors shadow-sm">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">{it.name}</div>
                        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mt-0.5">{it.category}</div>
                      </div>
                      <button type="button" onClick={() => { updateData((p: any) => ({...p, items: p.items.filter((i: any) => i.id !== it.id), statuses: Object.fromEntries(p.branches.map((b: string) => { const s = {...p.statuses[b]}; delete s[it.id]; return [b, s]; })), history: p.history.filter((h: any) => h.itemId !== it.id)})); showToast("Item deleted"); }} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors">Delete</button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals & Toasts */}
      <Modal open={confirmLogoutOpen} title="Sign Out" onClose={() => setConfirmLogoutOpen(false)} max="max-w-sm">
        <p className="text-sm text-slate-600 mb-6 mt-2">Are you sure you want to log out of the dashboard?</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => setConfirmLogoutOpen(false)} className="px-4 py-2.5 rounded-xl font-medium border border-slate-200 hover:bg-slate-50 text-sm transition-colors">Cancel</button>
          <button type="button" onClick={() => { setConfirmLogoutOpen(false); setSession(null); }} className="px-4 py-2.5 rounded-xl font-medium bg-rose-600 hover:bg-rose-700 text-white text-sm transition-colors shadow-sm">Sign Out</button>
        </div>
      </Modal>

      <Modal open={noteModal.open} title="Mark as 86 (Sold Out)" onClose={() => setNoteModal({ open: false, branch: "", item: null, value: "", error: "" })}>
        <form onSubmit={saveNote}>
          <div className="mb-4 mt-1">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{noteModal.branch}</div>
            <div className="text-lg font-bold text-slate-900">{noteModal.item?.name}</div>
          </div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-semibold text-slate-700">Reason for being unavailable <span className="text-rose-500">*</span></label>
            <button
              type="button"
              onClick={handleAutoReason}
              disabled={isGeneratingReason}
              className="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              {isGeneratingReason ? <Wand2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Auto-Suggest ✨
            </button>
          </div>
          <textarea autoFocus value={noteModal.value} onChange={(e: any) => setNoteModal((m: any) => ({ ...m, value: e.target.value, error: "" }))} rows={3} placeholder="e.g. Waiting for delivery, Spoiled batch..." className={cn("w-full rounded-xl border px-3.5 py-3 text-sm outline-none transition-all resize-none", noteModal.error ? "border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 bg-rose-50" : "border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100")} onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); } }} />
          {noteModal.error && <p className="text-xs font-medium text-rose-600 mt-1.5">{noteModal.error}</p>}
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setNoteModal({ open: false, branch: "", item: null, value: "", error: "" })} className="px-4 py-2.5 rounded-xl font-medium border border-slate-200 hover:bg-slate-50 text-sm transition-colors">Cancel</button>
            <button type="submit" className="px-4 py-2.5 rounded-xl font-medium bg-rose-600 hover:bg-rose-700 text-white text-sm transition-colors shadow-sm">Mark 86</button>
          </div>
        </form>
      </Modal>

      <Modal open={apologyModal.open} title="Draft Apology ✨" onClose={() => setApologyModal({ open: false, item: null, text: "", loading: false })}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Ready to send to the customer for the missing <span className="font-bold text-slate-700">{apologyModal.item?.name}</span>.</p>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[100px] flex items-center justify-center relative">
            {apologyModal.loading ? (
               <div className="flex flex-col items-center gap-2">
                 <Wand2 className="w-6 h-6 text-indigo-500 animate-spin" style={{ animationDuration: '3s' }} />
                 <span className="text-xs font-medium text-slate-500 animate-pulse">Drafting apology...</span>
               </div>
            ) : (
               <p className="text-sm text-slate-700 whitespace-pre-wrap">{apologyModal.text}</p>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setApologyModal({ open: false, item: null, text: "", loading: false })} className="px-4 py-2.5 rounded-xl font-medium border border-slate-200 hover:bg-slate-50 text-sm transition-colors">Close</button>
            <button 
              type="button" 
              disabled={apologyModal.loading}
              onClick={() => { copyToClipboard(apologyModal.text, () => showToast("Copied to clipboard!")); setApologyModal({ open: false, item: null, text: "", loading: false }); }} 
              className="px-4 py-2.5 rounded-xl font-medium bg-indigo-600 hover:bg-indigo-700 text-white text-sm transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              Copy Text
            </button>
          </div>
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3.5 rounded-xl shadow-xl text-sm font-medium flex items-center gap-3 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {toast}
        </div>
      )}
    </div>
  );
}

// ----- External Components -----
function LoginScreen({ branches, onSubmit }: any) {
  const [mode, setMode] = useState("branch");
  const [branch, setBranch] = useState(branches?.[0] || "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: any) => {
    e.preventDefault();
    onSubmit(mode, branch, pin, setError);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-8 space-y-7 animate-in zoom-in-95 duration-300">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-md mb-4 shadow-indigo-200">
          <CloudLightning className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Resto 86</h1>
        <p className="text-sm text-slate-500 font-medium">Cloud Availability Sync</p>
      </div>

      <div className="flex gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/50">
        {[
          { id: "branch", label: "Branch" },
          { id: "agent", label: "Agent" },
          { id: "admin", label: "Admin" }
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setMode(t.id); setError(""); setPin(""); }}
            className={cn("flex-1 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all", mode === t.id ? "bg-white text-slate-900 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {mode === "branch" && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5 ml-1">Location</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-all bg-white font-medium">
              {branches.map((b: string) => <option key={b}>{b}</option>)}
            </select>
          </div>
        )}

        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5 ml-1">Access PIN</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric" className={cn("w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all font-medium", error ? "border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 bg-rose-50 text-rose-900" : "border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 bg-white")} placeholder="••••" autoFocus />
          {error && <div className="text-xs font-semibold text-rose-600 mt-2 ml-1 animate-in fade-in">{error}</div>}
        </div>
      </div>

      <button type="submit" className={cn("w-full px-4 py-3.5 rounded-xl text-white text-sm font-bold transition-all shadow-md active:scale-[0.98]", mode === "agent" ? "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20" : "bg-slate-900 hover:bg-slate-800 shadow-slate-900/20")}>
        Secure Login
      </button>
      
      <p className="text-center text-xs text-slate-400 font-medium">Default PINs: 1234</p>
    </form>
  );
}
