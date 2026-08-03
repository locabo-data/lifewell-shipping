import { db, isFirebaseConfigured } from './firebase';

// --- localStorage フォールバック (Firebase未設定時) ---
const localStore = {
  get(key) {
    try {
      const raw = localStorage.getItem(`lw_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    localStorage.setItem(`lw_${key}`, JSON.stringify(value));
  },
};

async function firestoreModule() {
  return import('firebase/firestore');
}

// --- Profiles ---
export async function getProfile(uid) {
  if (!isFirebaseConfigured) return localStore.get(`profile_${uid}`);
  const { doc, getDoc } = await firestoreModule();
  const snap = await getDoc(doc(db, 'profiles', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateProfile(uid, data) {
  if (!isFirebaseConfigured) {
    const existing = localStore.get(`profile_${uid}`) || {};
    localStore.set(`profile_${uid}`, { ...existing, ...data });
    return;
  }
  const { doc, updateDoc } = await firestoreModule();
  await updateDoc(doc(db, 'profiles', uid), data);
}

export async function getAllProfiles() {
  if (!isFirebaseConfigured) {
    const profile = localStore.get('profile_demo-user');
    return profile ? [profile] : [];
  }
  const { collection, getDocs } = await firestoreModule();
  const snap = await getDocs(collection(db, 'profiles'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- Session Logs ---
export async function createSessionLog(data) {
  if (!isFirebaseConfigured) {
    const logs = localStore.get('session_logs') || [];
    const id = `log_${Date.now()}`;
    logs.unshift({ id, ...data, createdAt: new Date().toISOString() });
    localStore.set('session_logs', logs);
    return id;
  }
  const { collection, addDoc, serverTimestamp } = await firestoreModule();
  const ref = await addDoc(collection(db, 'session_logs'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSessionLog(id, data) {
  if (!isFirebaseConfigured) {
    const logs = localStore.get('session_logs') || [];
    const idx = logs.findIndex((l) => l.id === id);
    if (idx >= 0) logs[idx] = { ...logs[idx], ...data };
    localStore.set('session_logs', logs);
    return;
  }
  const { doc, updateDoc, serverTimestamp } = await firestoreModule();
  await updateDoc(doc(db, 'session_logs', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function getSessionLogs() {
  if (!isFirebaseConfigured) {
    return localStore.get('session_logs') || [];
  }
  const { collection, getDocs, query, orderBy } = await firestoreModule();
  const q = query(collection(db, 'session_logs'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- App Settings ---
export async function getAppSettings(settingId) {
  if (!isFirebaseConfigured) {
    return localStore.get(`settings_${settingId}`);
  }
  const { doc, getDoc } = await firestoreModule();
  const snap = await getDoc(doc(db, 'app_settings', settingId));
  return snap.exists() ? snap.data() : null;
}

export async function setAppSettings(settingId, data) {
  if (!isFirebaseConfigured) {
    localStore.set(`settings_${settingId}`, data);
    return;
  }
  const { doc, setDoc } = await firestoreModule();
  await setDoc(doc(db, 'app_settings', settingId), data, { merge: true });
}

// --- Holidays ---
export async function getHolidays() {
  const settings = await getAppSettings('holidays');
  return settings?.dates || [];
}

export async function setHolidays(dates) {
  await setAppSettings('holidays', { dates });
}

// --- O-PLUX Keywords ---
export async function getOpluxKeywords() {
  const settings = await getAppSettings('oplux_keywords');
  return settings?.keywords || [];
}

export async function setOpluxKeywords(keywords) {
  await setAppSettings('oplux_keywords', { keywords });
}

// --- Irregular Product Codes ---
export async function getIrregularCodes() {
  const settings = await getAppSettings('irregular_codes');
  return settings?.codes || [];
}

export async function setIrregularCodes(codes) {
  await setAppSettings('irregular_codes', { codes });
}

// --- Single Item Product Codes ---
export async function getSingleItemCodes() {
  const settings = await getAppSettings('single_item_codes');
  return settings?.codes || [];
}

export async function setSingleItemCodes(codes) {
  await setAppSettings('single_item_codes', { codes });
}

// --- API Config ---
export async function getApiConfig() {
  return await getAppSettings('api_config');
}

export async function setApiConfig(config) {
  await setAppSettings('api_config', config);
}

// --- 保留メールテンプレート ---
export async function getHoldMailTemplates() {
  const settings = await getAppSettings('hold_mail_templates');
  return settings?.templates || [];
}

export async function setHoldMailTemplates(templates) {
  await setAppSettings('hold_mail_templates', { templates });
}

// --- キャンセル対応状況 ---
export async function getCancelStates() {
  const settings = await getAppSettings('cancel_states');
  return settings?.states || [];
}

export async function setCancelStates(states) {
  await setAppSettings('cancel_states', { states });
}

// --- Invited Users（事前登録ユーザー） ---
export async function getInvitedUsers() {
  if (!isFirebaseConfigured) return [];
  const { collection, getDocs } = await firestoreModule();
  const snap = await getDocs(collection(db, 'invited_users'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// email でマッチする招待を1件取得（初回ログイン時のロール確認用）
export async function getInviteByEmail(email) {
  if (!isFirebaseConfigured) return null;
  const { collection, query, where, getDocs } = await firestoreModule();
  const q = query(collection(db, 'invited_users'), where('email', '==', email));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function addInvitedUser({ email, role, invitedBy }) {
  if (!isFirebaseConfigured) return;
  const { collection, addDoc, serverTimestamp } = await firestoreModule();
  await addDoc(collection(db, 'invited_users'), {
    email: email.toLowerCase().trim(),
    role,
    invitedBy,
    createdAt: serverTimestamp(),
  });
}

export async function removeInvitedUser(docId) {
  if (!isFirebaseConfigured) return;
  const { doc, deleteDoc } = await firestoreModule();
  await deleteDoc(doc(db, 'invited_users', docId));
}

// --- 住所校正キャッシュ (address_corrections) ---
export async function getAddressCorrections(orderIds) {
  if (!isFirebaseConfigured || !orderIds?.length) return {};
  try {
    const { doc, getDoc } = await firestoreModule();
    const results = {};
    await Promise.all(
      orderIds.map(async (id) => {
        const snap = await getDoc(doc(db, 'address_corrections', String(id)));
        if (snap.exists()) results[String(id)] = snap.data();
      })
    );
    return results;
  } catch {
    return {};
  }
}
