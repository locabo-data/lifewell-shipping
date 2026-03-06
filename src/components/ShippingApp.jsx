import { useState, useEffect, useCallback, Component } from 'react';
import {
  Calendar, CheckCircle2, Circle, Clock, AlertTriangle, Package,
  Settings, Users, LogOut, ChevronLeft, ChevronRight, Search,
  SkipForward, ArrowLeft, Truck, History, MapPin, CreditCard,
  FileText, User, Link, Shield, Copy, ShoppingBag, X, Plus,
  Trash2, Save, RefreshCw, Check, MessageSquare, ExternalLink,
  Zap, RotateCcw, Edit3, ClipboardCheck, Ban, Pause, Send,
  ChevronDown, ChevronUp, Info, CalendarDays, Warehouse,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  createSessionLog, updateSessionLog, getSessionLogs,
  getHolidays, setHolidays, getOpluxKeywords, setOpluxKeywords,
  getIrregularCodes, setIrregularCodes, getApiConfig, setApiConfig,
  getAppSettings, setAppSettings,
  getHoldMailTemplates, setHoldMailTemplates,
} from '../lib/firestore-helpers';
import {
  EcforceAPI, AddressCorrectionService, TaskProcessors,
  filterTbcFalse, normalizeOrder, classifyByIrregular, judgePersonName,
} from '../lib/ecforce-api';
import AdminPanel from '../pages/AdminPanel';

// ======================== Error Boundary ========================
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-cream-100 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-red-200 p-8 max-w-md text-center shadow-lg">
            <AlertTriangle size={40} className="mx-auto text-red-400 mb-4" />
            <h2 className="font-heading font-bold text-lg text-cream-900 mb-2">エラーが発生しました</h2>
            <p className="text-sm font-body text-cream-600 mb-4">{this.state.error?.message}</p>
            <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg font-heading font-semibold text-sm hover:bg-accent-dark transition-colors">
              <RotateCcw size={16} /> 再読み込み
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ======================== Constants ========================
const TASK_LIST = [
  { id: 'pendingShipment', label: '過去出荷分確認', desc: '未出荷・仮売上の受注', icon: Package, processor: 'pendingShipment' },
  { id: 'paymentError', label: '決済エラー確認', desc: '決済エラー状態の受注', icon: CreditCard, processor: 'paymentError' },
  { id: 'npPayment', label: 'NP別送確認', desc: 'NP後払い別送対象の受注', icon: FileText, processor: 'npPayment' },
  { id: 'nameAnomaly', label: 'テスト注文・氏名不備', desc: '氏名異常検出', icon: User, processor: 'nameAnomaly' },
  { id: 'duplicate', label: '重複注文確認', desc: '同一氏名/住所の重複', icon: Copy, processor: 'duplicate' },
  { id: 'singleItem', label: '単品注文確認', desc: '対象商品コード含む受注', icon: ShoppingBag, processor: 'singleItem' },
  { id: 'purchaseUrl', label: '購入URL確認', desc: 'defo/test URL (初回)', icon: Link, processor: 'purchaseUrl' },
  { id: 'addressCorrection', label: '住所校正', desc: 'AI住所校正（新規注文のみ）', icon: MapPin, processor: 'addressCorrection' },
  { id: 'oplux', label: 'O-PLUX審査確認', desc: 'REVIEW / OK判定 (初回)', icon: Shield, processor: 'oplux' },
];

// 日本の国民の祝日 (2025-2026)
const JAPAN_DEFAULT_HOLIDAYS = [
  // 2025年
  '2025-01-01','2025-01-13','2025-02-11','2025-02-23','2025-02-24',
  '2025-03-20','2025-04-29','2025-05-03','2025-05-04','2025-05-05','2025-05-06',
  '2025-07-21','2025-08-11','2025-09-15','2025-09-23','2025-10-13',
  '2025-11-03','2025-11-23','2025-11-24',
  // 2026年
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23',
  '2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-23','2026-10-12',
  '2026-11-03','2026-11-23',
];

// 出荷ステータス定義
const ORDER_SHIP_STATES = [
  { value: 'ready', label: '出荷準備完了', color: 'bg-blue-100 text-blue-700' },
  { value: 'shipped', label: '出荷済み', color: 'bg-green-100 text-green-700' },
  { value: 'on_hold', label: '保留', color: 'bg-amber-100 text-amber-700' },
  { value: 'cancelled', label: 'キャンセル', color: 'bg-red-100 text-red-700' },
];

// ======================== Utilities ========================
function isHolidayDate(date, holidays) {
  const ds = formatDate(date);
  return holidays.includes(ds);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 翌日の Date を返す */
function getNextDate(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * 出荷ルール判定
 * - 昼の部: 選択日当日発送 → 選択日の曜日/祝日で判定
 * - 夕の部: 翌日発送      → 翌日の曜日/祝日で判定
 * @param {Date}   sessionDate - セッション対象日（カレンダー選択日）
 * @param {string} sessionType - 'daytime' | 'evening'
 * @param {Array}  holidays    - 祝日リスト ['YYYY-MM-DD', ...]
 * @param {Object} overrides   - 手動変更マップ { 'YYYY-MM-DD': warehouse }
 * @returns {{ id, name, system, shippingDate, notes }}
 */
function getWarehouse(sessionDate, holidays, overrides = {}, sessionType = 'daytime') {
  // 夕の部は翌日発送なので翌日の日付で判定
  const shippingDate = sessionType === 'evening' ? getNextDate(sessionDate) : sessionDate;
  const ds = formatDate(shippingDate);

  if (overrides[ds]) {
    return {
      ...overrides[ds],
      shippingDate: ds,
      notes: sessionType === 'daytime' ? '当日発送分' : '翌日発送分',
    };
  }

  const day = shippingDate.getDay();
  const isHoliday = day === 0 || day === 6 || isHolidayDate(shippingDate, holidays);

  if (isHoliday) {
    return {
      id: 'fj_logi', name: 'FJロジ',
      system: 'komarobo', systemName: 'コマロボ',
      shippingDate: ds,
      notes: sessionType === 'daytime' ? '当日発送分' : '翌日発送分',
    };
  }
  return {
    id: 'tsukamoto', name: '塚本郵便逓送',
    system: 'cooola', systemName: 'COOOLa',
    shippingDate: ds,
    notes: sessionType === 'daytime' ? '当日発送分' : '翌日発送分',
  };
}

// ======================== Toast ========================
function Toast({ message, type = 'info', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  const bg = type === 'success' ? 'bg-green-700' : type === 'error' ? 'bg-red-700' : 'bg-cream-800';
  return <div className={`fixed top-4 right-4 z-50 ${bg} text-white px-5 py-3 rounded-lg shadow-lg animate-fadeIn font-body text-sm max-w-sm`}>{message}</div>;
}


// ======================== Loading Spinner ========================
function LoadingSpinner({ message = '処理中...' }) {
  return (
    <div className="fixed inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-[200]">
      <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4 min-w-[200px]">
        <div className="w-10 h-10 border-4 border-cream-200 border-t-accent rounded-full animate-spin" />
        <p className="text-sm font-body text-cream-700 font-semibold">{message}</p>
      </div>
    </div>
  );
}

// ======================== Main App (wrapped with ErrorBoundary) ========================
function NameEditDialog({ order, onClose, onSave }) {
  const addr = order.shipping_address || {};
  const [n01, setN01] = useState(addr.family_name || '');
  const [n02, setN02] = useState(addr.given_name || '');
  const [k01, setK01] = useState(addr.kana01 || '');
  const [k02, setK02] = useState(addr.kana02 || '');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-orange-100 rounded-lg text-orange-600"><Edit3 size={20} /></div>
            <h3 className="font-heading font-bold text-base text-cream-900">氏名を修正</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-cream-100 text-cream-400"><X size={20} /></button>
        </div>
        <p className="text-xs font-body text-cream-500 mb-4">受注ID: <span className="font-mono text-accent">{order.id}</span></p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-body text-cream-600 mb-1">姓（漢字）</label>
            <input type="text" value={n01} onChange={(e) => setN01(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-cream-300 text-sm font-body text-cream-800 focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="block text-xs font-body text-cream-600 mb-1">名（漢字）</label>
            <input type="text" value={n02} onChange={(e) => setN02(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-cream-300 text-sm font-body text-cream-800 focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="block text-xs font-body text-cream-600 mb-1">姓（カナ）</label>
            <input type="text" value={k01} onChange={(e) => setK01(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-cream-300 text-sm font-body text-cream-800 focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
          <div>
            <label className="block text-xs font-body text-cream-600 mb-1">名（カナ）</label>
            <input type="text" value={k02} onChange={(e) => setK02(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-cream-300 text-sm font-body text-cream-800 focus:outline-none focus:ring-2 focus:ring-accent/30" />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 bg-cream-100 hover:bg-cream-200 text-cream-700 text-sm rounded-lg font-body transition-colors">キャンセル</button>
          <button onClick={() => onSave({ name01: n01, name02: n02, kana01: k01, kana02: k02 })} className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg font-heading font-semibold transition-colors">反映</button>
        </div>
      </div>
    </div>
  );
}

export default function ShippingAppWrapper() {
  return <ErrorBoundary><ShippingApp /></ErrorBoundary>;
}

function ShippingApp() {
  const { user, profile, logout } = useAuth();

  const [currentPage, setCurrentPage] = useState('dashboard');
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [session, setSession] = useState(null);
  const [sessionLogId, setSessionLogId] = useState(null);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionType, setSessionType] = useState('daytime');
  const [staffName, setStaffName] = useState('');

  const [orders, setOrders] = useState([]);
  const [irregularOrders, setIrregularOrders] = useState({}); // { state: [orders] }
  const [taskResults, setTaskResults] = useState({});
  const [taskStatuses, setTaskStatuses] = useState({});
  // 受注ごとのステータス: { orderId: { checked: bool, memo: string, status: 'ok'|'issue'|'pending' } }
  const [orderStatuses, setOrderStatuses] = useState({});
  // 住所校正結果: { orderId: { original, correction, applied } }
  const [addressResults, setAddressResults] = useState({});
  // 住所校正: 一括反映選択リスト
  const [addressSelection, setAddressSelection] = useState(new Set());
  // 住所校正: 進捗 { completed, total } | null
  const [addressProgress, setAddressProgress] = useState(null);

  const [holidays, setHolidaysState] = useState([]);
  const [warehouseOverrides, setWarehouseOverrides] = useState({});
  const [opluxKeywords, setOpluxKeywordsState] = useState([]);
  const [irregularCodes, setIrregularCodesState] = useState([]);
  const [apiConfig, setApiConfigState] = useState(null);
  const [isDemo, setIsDemo] = useState(true);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingShipmentOrders, setPendingShipmentOrders] = useState([]);
  const [pendingShipmentLoading, setPendingShipmentLoading] = useState(false);
  const [pendingDateChangingIds, setPendingDateChangingIds] = useState(new Set()); // 日付変更中の受注ID
  const [pendingMovedIds, setPendingMovedIds] = useState(new Set()); // 出荷リストに追加済みの受注ID
  const [nameEditDialog, setNameEditDialog] = useState(null); // { order }
  const [cancelConfirmDialog, setCancelConfirmDialog] = useState(null); // { order }
  const [holdDialog, setHoldDialog] = useState(null); // { order, doHold, doSuspendSubs, mailTemplateId }
  const [holdMailTemplates, setHoldMailTemplatesState] = useState([]); // [{ id: string, label: string }]
  const [selectedShipIds, setSelectedShipIds] = useState(new Set());
  const [irregSelectedShipIds, setIrregSelectedShipIds] = useState({});
  // shippingRegistered: { [groupKey]: boolean }
  // groupKey = 'regular' | 'fj_logi' | 'tsukamoto' など warehouseId に対応
  const [shippingRegistered, setShippingRegistered] = useState({});
  const [shipRegisterModal, setShipRegisterModal] = useState(null); // { groupKey, shipListUrl, navigated }
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(null); // { fetched, total, page }
  const [addressApplying, setAddressApplying] = useState(false); // 住所校正一括反映中フラグ
  const [nameEditedIds, setNameEditedIds] = useState(new Set()); // 氏名修正済み受注ID
  // 差分チェック用
  const [sessionSnapshot, setSessionSnapshot] = useState({}); // { [orderId]: { state, payment_state, tbc } }
  const [changedOrders, setChangedOrders] = useState({});     // { [orderId]: { before, after, order } }
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [recheckDone, setRecheckDone] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);

  // API client instances
  const [ecforceApi, setEcforceApi] = useState(null);
  const [addressService, setAddressService] = useState(null);

  useEffect(() => {
    // user が確定する前は実行しない（Firestore 認証エラー回避）
    if (!user) return;
    async function loadSettings() {
      try {
        const [h, kw, codes, config, whOverrides, holdTpls] = await Promise.all([
          getHolidays(), getOpluxKeywords(), getIrregularCodes(), getApiConfig(),
          getAppSettings('warehouse_overrides'),
          getHoldMailTemplates(),
        ]);
        setHolidaysState(h);
        setOpluxKeywordsState(kw);
        setIrregularCodesState(codes);
        setApiConfigState(config);
        setWarehouseOverrides(whOverrides?.overrides || {});
        setHoldMailTemplatesState(holdTpls);
        const demo = !(config?.ecforceBaseUrl && config?.ecforceToken);
        setIsDemo(demo);
        setEcforceApi(new EcforceAPI({ isDemo: demo, apiConfig: config }));
        setAddressService(new AddressCorrectionService({ isDemo: demo, apiConfig: config }));
      } catch {
        setEcforceApi(new EcforceAPI({ isDemo: true }));
        setAddressService(new AddressCorrectionService({ isDemo: true }));
      }
    }
    loadSettings();
  }, [user]);

  // 過去出荷分タスクを開いたとき自動取得
  useEffect(() => {
    if (selectedTask === 'pendingShipment' && pendingShipmentOrders.length === 0 && !pendingShipmentLoading) {
      fetchPendingShipments();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask]);

  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), []);

  // ---------- セッション開始 ----------
  const startSession = async () => {
    if (!staffName.trim()) { showToast('担当者名を入力してください', 'error'); return; }
    setLoading('受注データを取得中...');
    setLoadingProgress(null);

    // 倉庫判定: 夕の部は翌日発送なので翌日の曜日/祝日で判定
    const warehouse = getWarehouse(selectedDate, holidays, warehouseOverrides, sessionType);
    // API取得日: 夕の部は翌日の scheduled_to_be_shipped_at で取得
    const shippingTargetDate = sessionType === 'evening' ? getNextDate(selectedDate) : selectedDate;
    const formattedDate = formatDate(shippingTargetDate);

    // 1. ecforce API から発送予定日で受注取得
    let rawOrders;
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      rawOrders = await api.getOrdersByShippingDate(
        formattedDate,
        (progress) => setLoadingProgress(progress),
      );
    } catch (err) {
      showToast(`受注取得エラー: ${err.message}`, 'error');
      setLoading(false);
      setLoadingProgress(null);
      return;
    }
    console.log(`[session] API取得受注数: ${rawOrders.length}件`);

    // 2. 全受注を正規化（times 抽出 → 初回/既存判定）
    const allNormalized = rawOrders.map(normalizeOrder);

    // 3. locked_order_ids = 全受注ID（tbc フィルタ前）
    //    locked_order_new_ids = 新規(times=1)のID（タスク1住所校正用）
    const allOrderIds = allNormalized.map((o) => o.id);
    const newOrderIds = allNormalized.filter((o) => o.is_first_order).map((o) => o.id);
    console.log(`[session] 全受注: ${allNormalized.length}件 (新規${newOrderIds.length}件)`);

    // 4. tbc=true（要対応受注）を除外
    const filteredOrders = filterTbcFalse(allNormalized);

    // 5. イレギュラーSKU判定・グループ分け
    //    irregularCodes: [{ code, warehouseId }] or ['code'] 形式に対応
    //    irregularMap のキーは商品コード, 値は warehouseId ('fj_logi' | 'tsukamoto')
    const irregularMap = {};
    if (Array.isArray(irregularCodes)) {
      irregularCodes.forEach((item) => {
        if (typeof item === 'object' && item.code) {
          // 新形式: warehouseId を使用 (fj_logi or tsukamoto)
          irregularMap[item.code] = item.warehouseId || 'fj_logi';
        } else if (typeof item === 'string') {
          // 旧形式: 単純なコードリスト → FJロジ扱い
          irregularMap[item] = 'fj_logi';
        }
      });
    }
    // デバッグ: irregularMap と最初の受注の line_items を表示
    console.log(`[session] irregularMap (${Object.keys(irregularMap).length}件):`, irregularMap);
    if (filteredOrders.length > 0) {
      console.log(`[session] 最初の受注(${filteredOrders[0].id}) line_items:`, filteredOrders[0].line_items);
    }
    const { normalOrders, irregularGroups } = classifyByIrregular(filteredOrders, irregularMap, sessionType);
    console.log(`[session] 通常受注: ${normalOrders.length}件, イレギュラー: ${Object.values(irregularGroups).reduce((s, a) => s + a.length, 0)}件`);

    // 通常受注をメインに設定
    setOrders(normalOrders);
    setIrregularOrders(irregularGroups);

    // セッション開始時スナップショット（通常 + イレギュラー全受注）
    const allSessionOrders = [...normalOrders, ...Object.values(irregularGroups).flat()];
    const snapshot = {};
    allSessionOrders.forEach((o) => {
      snapshot[o.id] = { state: o.state, human_state: o.human_state, payment_state: o.payment_state, tbc: !!o.tbc };
    });
    setSessionSnapshot(snapshot);
    setChangedOrders({});
    setRecheckDone(false);

    // タスクプロセッサ実行（通常受注に対して）
    const results = {};
    TASK_LIST.forEach((task) => {
      const processor = TaskProcessors[task.processor];
      if (task.id === 'singleItem') results[task.id] = processor(normalOrders, irregularCodes);
      else results[task.id] = processor(normalOrders);
    });
    setTaskResults(results);

    const statuses = {};
    TASK_LIST.forEach((t) => (statuses[t.id] = 'pending'));
    setTaskStatuses(statuses);
    setOrderStatuses({});
    setAddressResults({});
    setNameEditedIds(new Set());
    setPendingMovedIds(new Set());

    // 新規/既存カウント（tbc除外後の通常受注ベース）
    const newCount = normalOrders.filter((o) => o.is_first_order).length;
    const existingCount = normalOrders.length - newCount;

    const irregularTotal = Object.values(irregularGroups).reduce((s, a) => s + a.length, 0);
    const newSession = {
      date: formattedDate, type: sessionType,
      staffName: staffName.trim(), warehouse, status: 'in_progress',
      orderCount: normalOrders.length, newOrderCount: newCount, existingOrderCount: existingCount,
      irregularCount: irregularTotal,
      // locked_order_ids: 全受注ID（tbc フィルタ前）— サーバーサイドタスクが再取得に使用
      lockedOrderIds: allOrderIds,
      // locked_order_new_ids: 新規(times=1)のID — タスク1住所校正が使用
      lockedOrderNewIds: newOrderIds,
    };
    setSession(newSession);

    try {
      const logId = await createSessionLog({ ...newSession, userId: user.uid, userEmail: user.email });
      setSessionLogId(logId);
    } catch { /* ログ保存失敗は無視 */ }

    setShowSessionModal(false);
    setLoading(false);
    setLoadingProgress(null);
    const irregMsg = irregularTotal > 0 ? ` (イレギュラー${irregularTotal}件除外)` : '';
    showToast(`セッション開始: ${sessionType === 'daytime' ? '昼の部' : '夕の部'} / ${warehouse.name} / ${normalOrders.length}件${irregMsg}`, 'success');
  };

  // ---------- 受注個別ステータス ----------
  const setOrderStatus = (orderId, field, value) => {
    setOrderStatuses((prev) => ({
      ...prev,
      [orderId]: { ...(prev[orderId] || { checked: false, memo: '', status: 'pending' }), [field]: value },
    }));
  };

  const toggleOrderChecked = (orderId) => {
    setOrderStatuses((prev) => {
      const current = prev[orderId] || { checked: false, memo: '', status: 'pending' };
      return { ...prev, [orderId]: { ...current, checked: !current.checked } };
    });
  };

  // ---------- 住所の変更有無判定 ----------
  const hasAddressChange = (order, correction) => {
    if (!correction) return false;
    // AIが返す changed フラグを優先
    if (typeof correction.changed === 'boolean') return correction.changed;
    // フォールバック: 元の住所と校正後住所を正規化比較
    const addr = order.shipping_address;
    const origNorm = `${addr?.prefecture || ''}${addr?.city || ''}${addr?.street || ''}${addr?.building || ''}`.replace(/[\s　]/g, '');
    const corrFull = correction.address
      || `${correction.prefecture || ''}${correction.city || ''}${[correction.town, correction.chome, correction.banchi, correction.go].filter(Boolean).join('')}${correction.building || ''}${correction.building_number || ''}`;
    return origNorm !== corrFull.replace(/[\s　]/g, '');
  };

  // ---------- 住所校正の実行 ----------
  const runAddressCorrection = async (ordersList) => {
    if (!addressService) return;
    setAddressLoading(true);
    setAddressProgress({ completed: 0, total: ordersList.length });
    setAddressSelection(new Set());
    try {
      const addresses = ordersList.map((o) => o.shipping_address);
      await addressService.correctAddresses(addresses, {
        onProgress: ({ completed, total, index, result }) => {
          setAddressProgress({ completed, total });
          // 1件ごとに即時反映
          const orderId = ordersList[index].id;
          setAddressResults((prev) => ({ ...prev, [orderId]: { ...result, applied: false } }));
          // 修正ありなら自動選択
          if (result?.correction && hasAddressChange(ordersList[index], result.correction)) {
            setAddressSelection((prev) => new Set([...prev, orderId]));
          }
        },
      });
      showToast('住所校正が完了しました', 'success');
    } catch (err) {
      showToast(`住所校正エラー: ${err.message}`, 'error');
    }
    setAddressLoading(false);
    setAddressProgress(null);
  };

  // ---------- 住所校正結果をecforceに書き戻し（単件） ----------
  const applyAddressToEcforce = async (orderId) => {
    const result = addressResults[orderId];
    if (!result?.correction) return;
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      await api.applyAddressCorrection(orderId, result.correction);
      setAddressResults((prev) => ({ ...prev, [orderId]: { ...prev[orderId], applied: true } }));
      showToast('住所をecforceに反映しました', 'success');
    } catch (err) {
      showToast(`反映エラー: ${err.message}`, 'error');
    }
  };

  // ---------- 住所校正結果をecforceに一括書き戻し ----------
  const bulkApplyAddressesToEcforce = async (orderIds) => {
    const api = ecforceApi || new EcforceAPI({ isDemo: true });
    // orderId → order のルックアップマップ
    const orderMap = Object.fromEntries(orders.map((o) => [String(o.id), o]));
    const corrections = orderIds
      .map((orderId) => {
        const result = addressResults[orderId];
        if (!result?.correction || result.applied) return null;
        const c = result.correction;
        const r = result.original; // 元の shipping_address
        // =====================================================================
        // ⚠️ 絶対変更禁止: ecforce 住所フィールド組み立てルール
        //   addr01 = city + town  ← 都道府県(prefecture)は絶対に含めない
        //   addr02 = chome-banchi-go + " " + building + building_number
        //   都道府県は更新しない。prefecture_id は送信しない。
        //   → 詳細は /CLAUDE.md 参照
        // =====================================================================
        // addr01 = 市区町村 + 町名（都道府県は送らない）
        const addr01 = c.corrected_addr01
          || `${c.city || ''}${c.town || ''}`.trim();
        // addr02 = 丁目-番地-号（ハイフン結合）+ スペース + 建物名 建物番号
        const numPart = [c.chome, c.banchi, c.go].filter(Boolean).join('-');
        const buildingPart = [c.building, c.building_number].filter(Boolean).join(' ');
        const addr02 = c.corrected_addr02 || [numPart, buildingPart].filter(Boolean).join(' ');
        const zip = c.corrected_zip || r?.zip || '';

        // UpdateInput 形式に変換
        const order = orderMap[String(orderId)];
        const addrPayload = { addr01, addr02, zip };
        return {
          orderId: Number(orderId),
          orderShipping: addrPayload,
          orderBilling: addrPayload,
          customerId: order?.customer_id ?? null,
          customerBilling: addrPayload,
          subsOrderId: order?.subs_order_id ?? undefined,
          subsOrderShipping: order?.subs_order_id ? addrPayload : undefined,
          continueOnCustomerBillingError: true,
        };
      })
      .filter(Boolean);

    if (corrections.length === 0) return;

    setAddressApplying(true);
    try {
      const onLog = (msg, extra) => {
        console.log(`[ecforce-bulk-apply] ${msg}`, extra ?? '');
      };

      await api.bulkApplyAddressCorrections(corrections, onLog);
      const appliedIds = new Set(corrections.map((input) => input.orderId));
      setAddressResults((prev) => {
        const next = { ...prev };
        appliedIds.forEach((id) => { next[id] = { ...next[id], applied: true }; });
        return next;
      });

      // 出荷テーブルの表示に校正済み住所を反映
      // ※ bulkApplyAddressesToEcforce の addr01/addr02 組み立てと同じロジックで内部フィールドに変換
      //   shipping_address.city     = addr01（市区町村+町名）
      //   shipping_address.street   = addr02（丁目-番地-号）
      //   shipping_address.building = addr03（建物名）
      setOrders((prev) => prev.map((o) => {
        if (!appliedIds.has(o.id)) return o;
        const ar = addressResults[o.id];
        const c = ar?.correction;
        if (!c) return o;
        // addr01 相当: corrected_addr01 があればそれを、なければ city+town を結合
        const newCity = c.corrected_addr01
          || `${c.city || ''}${c.town || ''}`.trim()
          || o.shipping_address?.city;
        // addr02 相当: corrected_addr02 があればそれを、なければ chome-banchi-go を結合
        const numPart = [c.chome, c.banchi, c.go].filter(Boolean).join('-');
        const buildingPart = [c.building, c.building_number].filter(Boolean).join(' ');
        const newStreet = c.corrected_addr02
          || [numPart, buildingPart].filter(Boolean).join(' ')
          || o.shipping_address?.street;
        // addr03 相当（任意）
        const newBuilding = c.addr03 || o.shipping_address?.building || '';
        const newZip = c.corrected_zip || ar?.original?.zip || o.shipping_address?.zip;
        return {
          ...o,
          shipping_address: {
            ...o.shipping_address,
            city: newCity,
            street: newStreet,
            building: newBuilding,
            zip: newZip,
          },
        };
      }));

      setAddressSelection(new Set());
      showToast(`${corrections.length}件をecforceに反映しました`, 'success');
    } catch (err) {
      showToast(`反映エラー: ${err.message}`, 'error');
    }
    setAddressApplying(false);
  };

  // ---------- タスク完了/スキップ ----------
  const completeTask = (taskId) => {
    setTaskStatuses((prev) => {
      const next = { ...prev, [taskId]: 'completed' };
      // 全タスク完了チェック → セッションステータス更新
      const allDone = Object.values(next).every((s) => s === 'completed' || s === 'skipped');
      if (allDone) {
        handleAllTasksCompleted(next);
      }
      return next;
    });
    showToast(`${TASK_LIST.find((t) => t.id === taskId)?.label} 完了`, 'success');
    setCurrentPage('dashboard');
    setSelectedTask(null);
  };
  const skipTask = (taskId) => {
    setTaskStatuses((prev) => {
      const next = { ...prev, [taskId]: 'skipped' };
      const allDone = Object.values(next).every((s) => s === 'completed' || s === 'skipped');
      if (allDone) {
        handleAllTasksCompleted(next);
      }
      return next;
    });
    showToast(`${TASK_LIST.find((t) => t.id === taskId)?.label} スキップ`, 'info');
    setCurrentPage('dashboard');
    setSelectedTask(null);
  };

  // 全タスク完了時の処理
  const handleAllTasksCompleted = async (finalStatuses) => {
    // セッションステータスを tasks_completed に更新
    setSession((prev) => prev ? { ...prev, status: 'tasks_completed' } : prev);
    // 受注の出荷ステータスを初期化（ready = 出荷準備完了）
    const initialShipStatuses = {};
    orders.forEach((o) => {
      initialShipStatuses[o.id] = { shipStatus: 'ready', trackingNumber: '', memo: '' };
    });
    setShipmentStatuses(initialShipStatuses);
    // Firestoreに保存
    if (sessionLogId) {
      try {
        await updateSessionLog(sessionLogId, {
          status: 'tasks_completed',
          taskStatuses: finalStatuses,
          orderStatuses,
        });
      } catch { /* 保存失敗は無視 */ }
    }
    showToast('全タスク完了！出荷登録に進んでください', 'success');
    setCurrentPage('dashboard');
    setSelectedTask(null);
  };

  const allTasksDone = Object.values(taskStatuses).every((s) => s === 'completed' || s === 'skipped');
  const completedCount = Object.values(taskStatuses).filter((s) => s === 'completed' || s === 'skipped').length;
  const alertCount = TASK_LIST.reduce((sum, t) => sum + (taskResults[t.id]?.length || 0), 0);

  // ---------- 全タスク完了時: 差分チェック ----------
  // allTasksDone が true に変わった瞬間、セッション開始時のスナップショットと比較する
  useEffect(() => {
    if (!allTasksDone || !session || recheckDone || recheckLoading) return;

    const runRecheck = async () => {
      setRecheckLoading(true);
      try {
        const api = ecforceApi || new EcforceAPI({ isDemo: true });
        // state フィルタなしで取得（complete→他 への変化も検出）
        const freshOrders = await api.getRecheckOrders(session.date);
        const freshMap = {};
        freshOrders.forEach((o) => { freshMap[o.id] = o; });

        // スナップショットと比較（state / payment_state / tbc / human_state）
        const changed = {};
        Object.entries(sessionSnapshot).forEach(([id, before]) => {
          const numId = Number(id);
          const after = freshMap[numId];
          const orderRef =
            orders.find((o) => o.id === numId) ||
            Object.values(irregularOrders).flat().find((o) => o.id === numId);

          // フレッシュ取得で見つからない場合 = 日付変更などで対象外になった可能性 → 変更扱い
          if (!after) {
            changed[numId] = {
              before,
              after: { state: '(取得不可)', human_state: '(取得不可)', payment_state: '(取得不可)', tbc: before.tbc },
              order: orderRef,
              disappeared: true,
              shippingRelevant: true,
            };
            return;
          }

          const stateChanged = String(after.state ?? '') !== String(before.state ?? '');
          const paymentChanged = String(after.payment_state ?? '') !== String(before.payment_state ?? '');
          const tbcChanged = !!after.tbc !== !!before.tbc;
          const humanStateChanged = String(after.human_state ?? '') !== String(before.human_state ?? '');
          // shippingRelevant = 出荷に関わるステータス変更（state / payment_state / tbc）
          const shippingRelevant = stateChanged || paymentChanged || tbcChanged;
          if (shippingRelevant || humanStateChanged) {
            changed[numId] = {
              before,
              after: { state: after.state, human_state: after.human_state, payment_state: after.payment_state, tbc: !!after.tbc },
              order: orderRef,
              shippingRelevant,
            };
          }
        });

        setChangedOrders(changed);

        // 出荷選択から除外するのは shippingRelevant な変更のみ
        const shippingChangedIds = Object.entries(changed)
          .filter(([, info]) => info.shippingRelevant)
          .map(([id]) => Number(id));
        const changedIds = Object.keys(changed).map(Number);
        if (changedIds.length > 0) {
          // 出荷に関わるステータス変更があった受注を出荷選択から除外
          if (shippingChangedIds.length > 0) {
            setSelectedShipIds((prev) => {
              const next = new Set(prev);
              shippingChangedIds.forEach((id) => next.delete(id));
              return next;
            });
            setIrregSelectedShipIds((prev) => {
              const next = { ...prev };
              shippingChangedIds.forEach((id) => delete next[id]);
              return next;
            });
          }
          showToast(`${changedIds.length}件の受注で変更を検出しました`, 'warning');
        } else {
          showToast('受注ステータスに変更なし ✓', 'success');
        }
      } catch (err) {
        console.error('[recheck] 差分チェックエラー:', err);
        showToast(`差分チェックエラー: ${err.message}`, 'error');
      }
      setRecheckLoading(false);
      setRecheckDone(true);
    };

    runRecheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTasksDone, session]);

  // 出荷登録用ステータス管理
  const [shipmentStatuses, setShipmentStatuses] = useState({});  // { orderId: { shipStatus, trackingNumber, memo } }
  const [shippingExpanded, setShippingExpanded] = useState(true);

  // ---------- 出荷ステータス変更 ----------
  const setShipmentStatus = (orderId, field, value) => {
    setShipmentStatuses((prev) => ({
      ...prev,
      [orderId]: { ...(prev[orderId] || { shipStatus: 'ready', trackingNumber: '', memo: '' }), [field]: value },
    }));
  };

  const bulkSetShipStatus = (status) => {
    setShipmentStatuses((prev) => {
      const next = { ...prev };
      orders.forEach((o) => {
        next[o.id] = { ...(next[o.id] || { shipStatus: 'ready', trackingNumber: '', memo: '' }), shipStatus: status };
      });
      return next;
    });
  };

  // ---------- 過去出荷分取得 ----------
  const fetchPendingShipments = async () => {
    setPendingShipmentLoading(true);
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      const result = await api.getPendingShipments(session?.type || sessionType, session?.date || null);
      setPendingShipmentOrders(result);
    } catch (err) {
      showToast(`過去出荷分取得エラー: ${err.message}`, 'error');
    }
    setPendingShipmentLoading(false);
  };

  // ---------- 過去出荷分: 発送予定日を当日セッション日に変更して出荷リストへ追加 ----------
  const handleMovePendingToSession = async (order) => {
    if (!session?.date) return;
    setPendingDateChangingIds((prev) => new Set([...prev, order.id]));
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      // PUT /api/v2/admin/orders/bulk_update.json で発送予定日を更新
      await api.updateOrderShippingDate(order.id, `${session.date} 00:00:00`);
      // 出荷リスト（orders state）に追加
      const updatedOrder = { ...order, scheduled_to_be_shipped_at: session.date };
      setOrders((prev) => {
        // 重複チェック
        if (prev.some((o) => o.id === order.id)) return prev;
        return [...prev, updatedOrder];
      });
      // 選択状態にする
      setSelectedShipIds((prev) => new Set([...prev, order.id]));
      // セッションスナップショットにも追加
      setSessionSnapshot((prev) => ({
        ...prev,
        [order.id]: { state: order.state, human_state: order.human_state, payment_state: order.payment_state, tbc: !!order.tbc },
      }));
      // 移動済みとしてマーク
      setPendingMovedIds((prev) => new Set([...prev, order.id]));
      showToast(`受注 ${order.id} を当日の出荷リストに追加しました`, 'success');
    } catch (err) {
      showToast(`日付変更エラー: ${err.message}`, 'error');
    }
    setPendingDateChangingIds((prev) => {
      const next = new Set(prev);
      next.delete(order.id);
      return next;
    });
  };

  // ---------- テスト注文キャンセル ----------
  const handleCancelOrder = async (dialog) => {
    const { order, doOrder, doPayment, doSubs } = dialog;
    setLoading('キャンセル処理中...');
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      if (!api.isDemo) {
        // ① 対応状況 → キャンセル
        if (doOrder) {
          await api.proxyRequest('PUT', '/api/v2/admin/orders/bulk_update.json', {
            orders: [{ id: Number(order.id), state: 'canceled' }],
          });
        }
        // ② 決済 → void
        if (doPayment) {
          try {
            await api.proxyRequest('POST', '/api/v2/admin/orders/payment_status/bulk_update.json', {
              method: 'void',
              order_ids: [Number(order.id)],
            });
          } catch (e) {
            console.warn('[handleCancelOrder] void failed (non-fatal):', e.message);
          }
        }
        // ③ 定期受注 → キャンセル
        if (doSubs && order.subs_order_id) {
          await api.proxyRequest('PUT', '/api/v2/admin/subs_orders/bulk_update.json', {
            check_duplicate_link_numbers: 0,
            subs_orders: [{ id: Number(order.subs_order_id), state: 'canceled' }],
          });
        }
      }
      showToast(`受注 ${order.number} をキャンセルしました`, 'success');
      setCancelConfirmDialog(null);
    } catch (err) {
      showToast(`キャンセルエラー: ${err.message}`, 'error');
    }
    setLoading(false);
  };

  // ---------- 決済エラー保留処理 ----------
  const handleHoldOrder = async (dialog) => {
    const { order, doHold, doSuspendSubs, mailTemplateId } = dialog;
    setLoading('保留処理中...');
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      if (!api.isDemo) {
        // ① 受注 → 保留（horyuu）
        if (doHold) {
          await api.proxyRequest('PUT', '/api/v2/admin/orders/bulk_update.json', {
            orders: [{ id: Number(order.id), state: 'horyuu' }],
          });
        }
        // ② 定期受注 → 停止（suspend）
        if (doSuspendSubs && order.subs_order_id) {
          await api.proxyRequest('PUT', '/api/v2/admin/subs_orders/bulk_update.json', {
            check_duplicate_link_numbers: 0,
            subs_orders: [{ id: Number(order.subs_order_id), state: 'suspend' }],
          });
        }
        // ③ 受注メール送信
        if (mailTemplateId) {
          await api.proxyRequest('POST', `/api/v2/admin/orders/${order.id}/emails.json`, {
            email_template_id: Number(mailTemplateId),
          });
        }
      }
      showToast(`受注 ${order.number} を保留処理しました`, 'success');
      setHoldDialog(null);
    } catch (err) {
      showToast(`保留処理エラー: ${err.message}`, 'error');
    }
    setLoading(false);
  };

  // ---------- 氏名更新 ----------
  const handleUpdateName = async (order, nameData) => {
    setLoading('氏名を更新中...');
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      await api.updateOrderName(order.id, order.customer_id, order.subs_order_id, nameData);
      showToast(`受注 ${order.id} の氏名を更新しました`, 'success');
      setNameEditDialog(null);
      // ローカルの orders に反映（テーブル再描画用）
      setOrders((prev) => prev.map((o) => {
        if (o.id !== order.id) return o;
        return {
          ...o,
          shipping_address: {
            ...o.shipping_address,
            family_name: nameData.name01,
            given_name: nameData.name02,
            kana01: nameData.kana01,
            kana02: nameData.kana02,
          },
        };
      }));
      // 処理済みとしてマーク
      setNameEditedIds((prev) => new Set([...prev, order.id]));
    } catch (err) {
      showToast(`氏名更新エラー: ${err.message}`, 'error');
    }
    setLoading(false);
  };

  // ---------- 出荷ステータス変更（ecforce API呼び出し） ----------
  // groupKey: 'regular' | 'fj_logi' | 'tsukamoto' (irregular groups use warehouseId as key)
  const registerShippingGroup = async (orderIds, groupKey) => {
    if (orderIds.length === 0) { showToast('出荷対象がありません', 'error'); return; }
    // 倉庫に応じた shipment_state を決定
    // tsukamoto (COOOLa / 平日) → cooolawait
    // fj_logi   (コマロボ / 土日祝) → wmswait
    const warehouseId = groupKey === 'regular' ? session?.warehouse?.id : groupKey;
    const shipmentState = warehouseId === 'tsukamoto' ? 'cooolawait' : 'wmswait';
    // 出荷リストURL（全グループ共通）
    const shipListUrl = 'https://lifewell.co.jp/admin/orders?q%5Btoken%5D=bf9b7b48-93b6-4889-8c0b-094c79f166df';

    console.log(`[registerShippingGroup] groupKey=${groupKey} warehouseId=${warehouseId} shipmentState=${shipmentState}`);
    console.log(`[registerShippingGroup] orderIds=`, orderIds);

    setLoading('出荷ステータス変更中...');
    try {
      const api = ecforceApi || new EcforceAPI({ isDemo: true });
      console.log(`[registerShippingGroup] isDemo=${api.isDemo}`);
      const result = await api.registerShipping(orderIds, shipmentState);
      // ecforce bulk_update レスポンスから処理件数を取得（orders 配列の長さ）
      const processedCount = result?.orders?.length ?? orderIds.length;
      showToast(`${processedCount}件の出荷ステータスを変更しました`, 'success');
      // ポップアップ表示（出荷リスト登録の案内）
      setShipRegisterModal({
        groupKey, shipListUrl, navigated: false,
        submitted: orderIds.length,
        processed: processedCount,
      });
    } catch (err) {
      showToast(`出荷ステータス変更エラー: ${err.message}`, 'error');
    }
    setLoading(false);
  };

  // ポップアップで「完了」が押されたとき
  const completeShipRegister = async (groupKey) => {
    const modal = shipRegisterModal; // 現在のモーダル情報（submitted/processed）
    setShipRegisterModal(null);
    setShippingRegistered((prev) => {
      // { submitted, processed } オブジェクトで保存（truthy なのでブール判定は変わらない）
      const info = { submitted: modal?.submitted ?? 0, processed: modal?.processed ?? 0 };
      const next = { ...prev, [groupKey]: info };
      // 全グループ（regular + 全 irregularOrders キー）が完了したかチェック
      const allKeys = ['regular', ...Object.keys(irregularOrders)];
      const allDone = allKeys.every((k) => next[k]);
      if (allDone) {
        setSession((s) => s ? { ...s, status: 'completed' } : s);
        if (sessionLogId) {
          updateSessionLog(sessionLogId, { status: 'completed', taskStatuses, orderStatuses }).catch(() => {});
        }
      }
      return next;
    });
  };

  // ---------- セッション終了（リセット） ----------
  const endSession = () => {
    setSession(null);
    setOrders([]);
    setIrregularOrders({});
    setTaskResults({});
    setTaskStatuses({});
    setOrderStatuses({});
    setAddressResults({});
    setShipmentStatuses({});
    setSelectedTask(null);
    setCurrentPage('dashboard');
  };

  // ---------- セッション履歴 ----------
  const loadHistory = async () => {
    setLoading('履歴を読み込み中...');
    try { setSessionHistory(await getSessionLogs()); }
    catch { showToast('履歴の読み込みに失敗しました', 'error'); }
    setLoading(false);
  };

  // ======================== Calendar ========================
  const renderCalendar = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(<div key={`e-${i}`} />);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
      const isSelected = formatDate(date) === formatDate(selectedDate);
      const holiday = isHolidayDate(date, holidays);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const wh = getWarehouse(date, holidays, warehouseOverrides);
      days.push(
        <button key={d} onClick={() => setSelectedDate(date)}
          className={`relative p-1.5 rounded-lg text-sm font-mono transition-all
            ${isSelected ? 'bg-accent text-white ring-2 ring-accent/30' : ''} ${isToday && !isSelected ? 'ring-2 ring-cream-400' : ''}
            ${!isSelected ? 'hover:bg-cream-200' : ''} ${holiday || isWeekend ? 'text-red-600' : 'text-cream-900'}`}>
          <span className="block">{d}</span>
          <span className={`block text-[9px] leading-tight mt-0.5 ${isSelected ? 'text-white/80' : 'text-cream-500'}`}>{wh.id === 'fj_logi' ? 'FJ' : '塚本'}</span>
        </button>
      );
    }
    return days;
  };

  // ======================== Sidebar ========================
  const renderSidebar = () => (
    <aside className="w-56 bg-white border-r border-cream-200 flex flex-col h-full shrink-0">
      <div className="p-5 border-b border-cream-200">
        <h1 className="font-heading font-bold text-xl text-cream-900 tracking-tight">Lifewell</h1>
        <p className="text-xs text-cream-500 mt-0.5 font-body">出荷業務管理</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {[
          { id: 'dashboard', label: 'ダッシュボード', icon: Package },
          { id: 'history', label: 'セッション履歴', icon: History },
          ...(profile?.role === 'admin' ? [
            { id: 'warehouse', label: '倉庫カレンダー', icon: Calendar },
            { id: 'settings', label: '設定', icon: Settings },
            { id: 'users', label: 'ユーザー管理', icon: Users },
          ] : []),
        ].map((item) => (
          <button key={item.id} onClick={() => { setCurrentPage(item.id); setSelectedTask(null); if (item.id === 'history') loadHistory(); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body transition-colors
              ${currentPage === item.id ? 'bg-cream-200 text-cream-900 font-bold' : 'text-cream-600 hover:bg-cream-100 hover:text-cream-800'}`}>
            <item.icon size={18} />{item.label}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-cream-200">
        <div className={`text-center text-xs font-mono px-3 py-1.5 rounded-full mb-3 ${isDemo ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          {isDemo ? 'DEMO' : 'LIVE'}
        </div>
        <div className="flex items-center gap-2 px-2 mb-2">
          {user?.photoURL && <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" />}
          <div className="truncate">
            <p className="text-xs font-body text-cream-800 truncate">{profile?.displayName || user?.email}</p>
            <p className="text-[10px] text-cream-500">{profile?.role}</p>
          </div>
        </div>
        <button onClick={logout} className="w-full flex items-center justify-center gap-2 text-xs text-cream-500 hover:text-cream-700 py-2 transition-colors font-body">
          <LogOut size={14} /> ログアウト
        </button>
      </div>
    </aside>
  );

  // ======================== Dashboard ========================
  const renderDashboard = () => (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading font-bold text-xl text-cream-900">ダッシュボード</h2>
          {session && (
            <div className="flex items-center gap-3 text-sm font-body text-cream-600">
              <Clock size={16} />
              {session.type === 'daytime' ? '昼の部 (12:30締切)' : '夕の部 (16:00締切)'}
              <span className="text-cream-400">|</span>{session.warehouse?.name}
              <span className="text-cream-400">|</span>{session.staffName}
              {session.status === 'tasks_completed' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-heading">
                  <ClipboardCheck size={12} /> チェック完了
                </span>
              )}
              {session.status === 'completed' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-600 text-white rounded-full text-xs font-heading">
                  <CheckCircle2 size={12} /> 出荷完了
                </span>
              )}
            </div>
          )}
        </div>
        {allTasksDone && session ? (
          /* ===== allTasksDone layout: full-width ===== */
          <>
            {/* Compact session info bar */}
            <div className="bg-white rounded-xl border border-cream-200 p-4 mb-5 flex items-center gap-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-body text-cream-700">
                <CalendarDays size={15} className="text-cream-400" />
                <span className="font-semibold">{session.date}</span>
              </div>
              <span className="text-cream-300">|</span>
              <div className="text-sm font-body text-cream-700">
                {session.type === 'daytime' ? '昼の部' : '夕の部'}
              </div>
              <span className="text-cream-300">|</span>
              <div className="flex items-center gap-2 text-sm font-body text-cream-700">
                <Warehouse size={15} className="text-cream-400" />
                {session.warehouse?.name}
              </div>
              <span className="text-cream-300">|</span>
              <div className="text-sm font-body text-cream-500">{session.staffName}</div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-5 gap-3 mb-5">
              <StatCard label="受注数" value={orders.length} />
              <StatCard label="新規" value={session.newOrderCount} sub="件" color="text-blue-600" />
              <StatCard label="既存" value={session.existingOrderCount} sub="件" color="text-cream-600" />
              <StatCard label="完了タスク" value={completedCount} sub={`/${TASK_LIST.length}`} />
              <StatCard label="検出アラート" value={alertCount} color="text-amber-600" />
            </div>

            {/* Collapsed task accordion */}
            <div className="bg-white rounded-xl border border-green-200 shadow-sm overflow-hidden mb-5">
              <button
                onClick={() => setTasksCollapsed(!tasksCollapsed)}
                className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-green-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-green-500" />
                  <span className="font-heading font-semibold text-sm text-green-800">
                    全{TASK_LIST.length}タスク完了
                  </span>
                  <span className="text-xs font-body text-green-600 ml-1">
                    （アラート: {alertCount}件）
                  </span>
                </div>
                <ChevronDown size={16} className={`text-cream-400 transition-transform ${tasksCollapsed ? 'rotate-180' : ''}`} />
              </button>
              {tasksCollapsed && (
                <div className="border-t border-green-100">
                  {TASK_LIST.map((task, idx) => {
                    const status = taskStatuses[task.id];
                    const count = taskResults[task.id]?.length;
                    const Icon = task.icon;
                    const isDone = status === 'completed' || status === 'skipped';
                    return (
                      <div key={task.id}
                        className="w-full flex items-center gap-4 px-5 py-4 border-b border-cream-100 last:border-b-0 bg-cream-50">
                        {/* Step badge */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all
                          ${status === 'completed' ? 'bg-green-500 text-white' : status === 'skipped' ? 'bg-cream-300 text-cream-600' : 'bg-cream-200 text-cream-500'}`}>
                          {status === 'completed' ? <CheckCircle2 size={18} /> : status === 'skipped' ? <SkipForward size={16} /> : idx + 1}
                        </div>
                        {/* Icon */}
                        <div className={`p-2 rounded-lg shrink-0 ${isDone ? 'bg-green-50 text-green-500' : 'bg-cream-100 text-cream-400'}`}>
                          <Icon size={18} />
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className={`font-bold text-sm ${isDone ? 'text-cream-600' : 'text-cream-800'}`}>{task.label}</p>
                          {count !== undefined && (
                            <p className="text-xs text-cream-500 mt-0.5">
                              {count > 0 ? <span className="text-amber-600 font-semibold">{count}件 検出</span> : <span className="text-green-600">問題なし</span>}
                            </p>
                          )}
                        </div>
                        {/* Right indicator */}
                        {status === 'completed' && <span className="text-xs text-green-600 font-semibold shrink-0">完了</span>}
                        {status === 'skipped' && <span className="text-xs text-cream-400 shrink-0">スキップ</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Full-width shipping panels */}
            <div className="mt-5 animate-fadeIn space-y-4">

              {/* 差分なし — 確認完了バナー */}
              {recheckDone && Object.keys(changedOrders).length === 0 && (
                <div className="bg-green-50 rounded-xl border border-green-300 px-5 py-4 flex items-center gap-3 shadow-sm">
                  <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-heading font-bold text-green-800">ステータス変更なし — 出荷対象に差異はありません</p>
                    <p className="text-xs font-body text-green-600 mt-0.5">セッション開始時から全受注のステータスに変更はありませんでした。</p>
                  </div>
                </div>
              )}

              {/* 変更検出アラートバナー */}
              {recheckDone && Object.keys(changedOrders).length > 0 && (
                <div className="bg-amber-50 rounded-xl border border-amber-300 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-heading font-bold text-amber-800">
                        タスク作業中に変更が検出されました（{Object.keys(changedOrders).length}件）
                      </p>
                      <p className="text-xs font-body text-amber-700 mt-1">
                        以下の受注で変更が検出されました。出荷ステータス変更のある受注は出荷選択から除外されています。内容を確認してください。
                      </p>
                      <div className="mt-3 space-y-2">
                        {Object.entries(changedOrders).map(([id, info]) => {
                          const order = info.order;
                          const name = order
                            ? `${order.shipping_address?.family_name || ''} ${order.shipping_address?.given_name || ''}`.trim()
                            : '';
                          return (
                            <div key={id} className={`bg-white rounded-lg border px-3 py-2.5 text-xs font-body ${info.shippingRelevant === false ? 'border-blue-200' : 'border-amber-200'}`}>
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="font-mono font-bold text-accent">受注ID: {id}</span>
                                {name && <span className="text-cream-600">{name}</span>}
                                {info.shippingRelevant === false && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 text-[10px] font-heading font-semibold">対応状況のみ</span>
                                )}
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-4">
                                {info.disappeared ? (
                                  <span className="text-red-600 font-semibold">⚠ 受注がAPIから取得不可（出荷予定日変更等の可能性）</span>
                                ) : (
                                  <>
                                    {String(info.before.state ?? '') !== String(info.after.state ?? '') && (
                                      <span className="text-amber-700">
                                        受注状態: <span className="line-through text-cream-400 mr-1">{info.before.state}</span>→<span className="font-semibold ml-1">{info.after.state}</span>
                                      </span>
                                    )}
                                    {String(info.before.human_state ?? '') !== String(info.after.human_state ?? '') && (
                                      <span className={info.shippingRelevant === false ? 'text-blue-700' : 'text-amber-700'}>
                                        対応状況: <span className="line-through text-cream-400 mr-1">{info.before.human_state || '-'}</span>→<span className="font-semibold ml-1">{info.after.human_state || '-'}</span>
                                      </span>
                                    )}
                                    {String(info.before.payment_state ?? '') !== String(info.after.payment_state ?? '') && (
                                      <span className="text-amber-700">
                                        決済状況: <span className="line-through text-cream-400 mr-1">{info.before.payment_state}</span>→<span className="font-semibold ml-1">{info.after.payment_state}</span>
                                      </span>
                                    )}
                                    {!!info.before.tbc !== !!info.after.tbc && (
                                      <span className="text-amber-700">
                                        要対応: <span className="line-through text-cream-400 mr-1">{info.before.tbc ? 'あり' : 'なし'}</span>→<span className="font-semibold ml-1">{info.after.tbc ? 'あり' : 'なし'}</span>
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 通常受注グループ */}
              {(() => {
                const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
                const allIds = orders.map((o) => o.id);
                // shippingRelevant な変更のみ amber section に表示（human_state のみ変更は除外）
                const changedIds = new Set(
                  Object.entries(changedOrders)
                    .filter(([, info]) => info.shippingRelevant !== false)
                    .map(([id]) => Number(id))
                );
                const allSelected = allIds.length > 0 && allIds.every((id) => selectedShipIds.has(id));
                const toggleAll = () => setSelectedShipIds(allSelected ? new Set() : new Set(allIds));
                const toggleOne = (id) => setSelectedShipIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
                const selectedIds = [...selectedShipIds].filter((id) => allIds.includes(id));
                return (
                  <div className="bg-white rounded-xl border border-green-200 shadow-sm overflow-hidden">
                    <div className="bg-green-50 px-5 py-4 flex items-center justify-between border-b border-green-100">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-green-100 rounded-lg text-green-600"><ClipboardCheck size={22} /></div>
                        <div>
                          <h3 className="font-heading font-bold text-base text-green-800">通常受注 — 出荷ステータス変更</h3>
                          <p className="text-xs font-body text-green-600 mt-0.5">{session.warehouse?.name} / {orders.length}件</p>
                        </div>
                      </div>
                      {shippingRegistered.regular && (
                        <span className="flex items-center gap-1.5 text-green-600 text-sm font-heading font-bold"><CheckCircle2 size={16} /> 登録済み</span>
                      )}
                    </div>
                    {!shippingRegistered.regular && (
                      <>
                        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                          <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-cream-50">
                              <tr>
                                <th className="px-3 py-2.5 w-10">
                                  <button onClick={toggleAll} className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${allSelected ? 'bg-accent border-accent text-white' : 'border-cream-300 hover:border-accent'}`}>
                                    {allSelected && <Check size={11} />}
                                  </button>
                                </th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">受注ID</th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">氏名</th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">住所</th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">回数</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* ── ステータス変更あり ── */}
                              {orders.some((o) => changedIds.has(o.id)) && (
                                <tr className="bg-amber-100 border-t border-amber-300">
                                  <td colSpan={5} className="px-3 py-1.5 text-xs font-heading font-bold text-amber-700">
                                    <span className="flex items-center gap-1"><AlertTriangle size={11} /> ステータス変更あり</span>
                                  </td>
                                </tr>
                              )}
                              {orders.filter((o) => changedIds.has(o.id)).map((order) => {
                                const checked = selectedShipIds.has(order.id);
                                const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
                                return (
                                  <tr key={order.id} className={`border-t border-amber-200 transition-colors ${checked ? 'bg-amber-100' : 'bg-amber-50'}`}>
                                    <td className="px-3 py-2.5 border-l-4 border-l-amber-400">
                                      <button onClick={() => toggleOne(order.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-accent border-accent text-white' : 'border-amber-400 hover:border-amber-500'}`}>
                                        {checked && <Check size={11} />}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                                          {order.id}<ExternalLink size={11} className="opacity-60" />
                                        </a>
                                        <AlertTriangle size={13} className="text-amber-500 shrink-0" title="ステータス変更あり" />
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-sm font-body text-cream-800">{order.shipping_address?.family_name} {order.shipping_address?.given_name}</td>
                                    <td className="px-3 py-2.5 text-xs font-body text-cream-600 max-w-[200px] truncate">{order.shipping_address?.prefecture}{order.shipping_address?.city}{order.shipping_address?.street}</td>
                                    <td className="px-3 py-2.5 text-xs font-mono text-cream-600">{order.times ?? '-'}</td>
                                  </tr>
                                );
                              })}
                              {/* ── 通常受注 ── */}
                              {orders.some((o) => changedIds.has(o.id)) && orders.some((o) => !changedIds.has(o.id)) && (
                                <tr className="bg-cream-50 border-t-2 border-cream-200">
                                  <td colSpan={5} className="px-3 py-1.5 text-xs font-heading font-semibold text-cream-500">通常受注</td>
                                </tr>
                              )}
                              {orders.filter((o) => !changedIds.has(o.id)).map((order) => {
                                const checked = selectedShipIds.has(order.id);
                                const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
                                return (
                                  <tr key={order.id} className={`border-t border-cream-100 transition-colors ${checked ? 'bg-accent/5' : 'hover:bg-cream-50/50'}`}>
                                    <td className="px-3 py-2.5">
                                      <button onClick={() => toggleOne(order.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-accent border-accent text-white' : 'border-cream-300 hover:border-accent'}`}>
                                        {checked && <Check size={11} />}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                                          {order.id}<ExternalLink size={11} className="opacity-60" />
                                        </a>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-sm font-body text-cream-800">{order.shipping_address?.family_name} {order.shipping_address?.given_name}</td>
                                    <td className="px-3 py-2.5 text-xs font-body text-cream-600 max-w-[200px] truncate">{order.shipping_address?.prefecture}{order.shipping_address?.city}{order.shipping_address?.street}</td>
                                    <td className="px-3 py-2.5 text-xs font-mono text-cream-600">{order.times ?? '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="px-5 py-4 bg-cream-50 border-t border-cream-100 flex items-center justify-between">
                          <p className="text-xs font-body text-cream-500">{selectedIds.length}件 選択中</p>
                          <button onClick={() => registerShippingGroup(selectedIds, 'regular')} disabled={selectedIds.length === 0 || loading}
                            className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-heading font-bold transition-colors shadow-md disabled:opacity-50">
                            <Truck size={18} /> 出荷ステータス変更 ({selectedIds.length}件)
                          </button>
                        </div>
                      </>
                    )}
                    {shippingRegistered.regular && (() => {
                      const info = shippingRegistered.regular;
                      const diff = (info.submitted ?? 0) - (info.processed ?? 0);
                      return (
                        <div className="px-5 py-4 space-y-2">
                          <div className="flex items-center gap-3">
                            <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                            <span className="text-sm font-heading font-bold text-green-800">出荷ステータス変更・出荷リスト登録 完了</span>
                          </div>
                          <div className="flex items-center gap-4 pl-7 text-xs font-body">
                            <span className="text-cream-600">
                              処理完了: <span className="font-semibold text-green-700">{info.processed}件</span>
                              <span className="mx-1 text-cream-400">/</span>
                              母数: <span className="font-semibold">{info.submitted}件</span>
                            </span>
                            {diff > 0 ? (
                              <span className="flex items-center gap-1 text-amber-600 font-semibold">
                                <AlertTriangle size={12} /> 差分: {diff}件 未処理
                              </span>
                            ) : (
                              <span className="text-green-600">✓ 差分なし</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* イレギュラー受注グループ（倉庫ごとに個別パネル） */}
              {Object.entries(irregularOrders).map(([warehouseId, groupOrders]) => {
                if (!groupOrders || groupOrders.length === 0) return null;
                const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
                const warehouseLabel = warehouseId === 'tsukamoto' ? '塚本郵便逓送 (COOOLa)' : 'FJロジ (コマロボ)';
                const stateLabel = warehouseId === 'tsukamoto' ? 'cooolawait' : 'wmswait';
                // shippingRelevant な変更のみ amber section に表示（human_state のみ変更は除外）
                const changedIds = new Set(
                  Object.entries(changedOrders)
                    .filter(([, info]) => info.shippingRelevant !== false)
                    .map(([id]) => Number(id))
                );
                const allIds = groupOrders.map((o) => o.id);
                const allSelected = allIds.length > 0 && allIds.every((id) => irregSelectedShipIds[id]);
                const toggleAll = () => setIrregSelectedShipIds((prev) => {
                  const n = { ...prev };
                  if (allSelected) { allIds.forEach((id) => delete n[id]); }
                  else { allIds.forEach((id) => { n[id] = true; }); }
                  return n;
                });
                const toggleOne = (id) => setIrregSelectedShipIds((prev) => {
                  const n = { ...prev }; n[id] ? delete n[id] : (n[id] = true); return n;
                });
                const selectedIds = allIds.filter((id) => irregSelectedShipIds[id]);
                const isDone = !!shippingRegistered[warehouseId];
                return (
                  <div key={warehouseId} className="bg-white rounded-xl border border-orange-200 shadow-sm overflow-hidden">
                    <div className="bg-orange-50 px-5 py-4 flex items-center justify-between border-b border-orange-100">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-orange-100 rounded-lg text-orange-600"><Package size={22} /></div>
                        <div>
                          <h3 className="font-heading font-bold text-base text-orange-800">
                            イレギュラー受注 — 出荷ステータス変更
                          </h3>
                          <p className="text-xs font-body text-orange-600 mt-0.5">
                            {warehouseLabel} / {stateLabel} / {groupOrders.length}件
                          </p>
                        </div>
                      </div>
                      {isDone && (
                        <span className="flex items-center gap-1.5 text-green-600 text-sm font-heading font-bold"><CheckCircle2 size={16} /> 登録済み</span>
                      )}
                    </div>
                    {!isDone && (
                      <>
                        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                          <table className="w-full">
                            <thead className="sticky top-0 z-10 bg-cream-50">
                              <tr>
                                <th className="px-3 py-2.5 w-10">
                                  <button onClick={toggleAll} className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${allSelected ? 'bg-accent border-accent text-white' : 'border-cream-300 hover:border-accent'}`}>
                                    {allSelected && <Check size={11} />}
                                  </button>
                                </th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">受注ID</th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">氏名</th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">住所</th>
                                <th className="px-3 py-2.5 text-xs font-heading font-semibold text-cream-500 text-left">商品コード</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* ── ステータス変更あり ── */}
                              {groupOrders.some((o) => changedIds.has(o.id)) && (
                                <tr className="bg-amber-100 border-t border-amber-300">
                                  <td colSpan={5} className="px-3 py-1.5 text-xs font-heading font-bold text-amber-700">
                                    <span className="flex items-center gap-1"><AlertTriangle size={11} /> ステータス変更あり</span>
                                  </td>
                                </tr>
                              )}
                              {groupOrders.filter((o) => changedIds.has(o.id)).map((order) => {
                                const checked = !!irregSelectedShipIds[order.id];
                                const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
                                const codes = (order.line_items || []).map((i) => i.product_code).filter(Boolean);
                                return (
                                  <tr key={order.id} className={`border-t border-amber-200 transition-colors ${checked ? 'bg-amber-100' : 'bg-amber-50'}`}>
                                    <td className="px-3 py-2.5 border-l-4 border-l-amber-400">
                                      <button onClick={() => toggleOne(order.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-orange-500 border-orange-500 text-white' : 'border-amber-400 hover:border-amber-500'}`}>
                                        {checked && <Check size={11} />}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                                          {order.id}<ExternalLink size={11} className="opacity-60" />
                                        </a>
                                        <AlertTriangle size={13} className="text-amber-500 shrink-0" title="ステータス変更あり" />
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-sm font-body text-cream-800">{order.shipping_address?.family_name} {order.shipping_address?.given_name}</td>
                                    <td className="px-3 py-2.5 text-xs font-body text-cream-600 max-w-[180px] truncate">{order.shipping_address?.prefecture}{order.shipping_address?.city}{order.shipping_address?.street}</td>
                                    <td className="px-3 py-2.5">
                                      {codes.map((c, i) => <span key={i} className="inline-block mr-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-mono">{c}</span>)}
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* ── 通常受注 ── */}
                              {groupOrders.some((o) => changedIds.has(o.id)) && groupOrders.some((o) => !changedIds.has(o.id)) && (
                                <tr className="bg-cream-50 border-t-2 border-cream-200">
                                  <td colSpan={5} className="px-3 py-1.5 text-xs font-heading font-semibold text-cream-500">通常受注</td>
                                </tr>
                              )}
                              {groupOrders.filter((o) => !changedIds.has(o.id)).map((order) => {
                                const checked = !!irregSelectedShipIds[order.id];
                                const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
                                const codes = (order.line_items || []).map((i) => i.product_code).filter(Boolean);
                                return (
                                  <tr key={order.id} className={`border-t border-cream-100 transition-colors ${checked ? 'bg-orange-50/50' : 'hover:bg-cream-50/50'}`}>
                                    <td className="px-3 py-2.5">
                                      <button onClick={() => toggleOne(order.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-orange-500 border-orange-500 text-white' : 'border-cream-300 hover:border-orange-400'}`}>
                                        {checked && <Check size={11} />}
                                      </button>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                                          {order.id}<ExternalLink size={11} className="opacity-60" />
                                        </a>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-sm font-body text-cream-800">{order.shipping_address?.family_name} {order.shipping_address?.given_name}</td>
                                    <td className="px-3 py-2.5 text-xs font-body text-cream-600 max-w-[180px] truncate">{order.shipping_address?.prefecture}{order.shipping_address?.city}{order.shipping_address?.street}</td>
                                    <td className="px-3 py-2.5">
                                      {codes.map((c, i) => <span key={i} className="inline-block mr-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-mono">{c}</span>)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="px-5 py-4 bg-cream-50 border-t border-cream-100 flex items-center justify-between">
                          <p className="text-xs font-body text-cream-500">{selectedIds.length}件 選択中</p>
                          <button onClick={() => registerShippingGroup(selectedIds, warehouseId)} disabled={selectedIds.length === 0 || loading}
                            className="flex items-center gap-2 px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg font-heading font-bold transition-colors shadow-md disabled:opacity-50">
                            <Truck size={18} /> 出荷ステータス変更 ({selectedIds.length}件)
                          </button>
                        </div>
                      </>
                    )}
                    {isDone && (() => {
                      const info = shippingRegistered[warehouseId];
                      const diff = (info?.submitted ?? 0) - (info?.processed ?? 0);
                      return (
                        <div className="px-5 py-4 space-y-2">
                          <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle2 size={18} />
                            <span className="text-sm font-heading font-bold text-green-800">出荷ステータス変更・出荷リスト登録 完了</span>
                          </div>
                          <div className="flex items-center gap-4 pl-7 text-xs font-body">
                            <span className="text-cream-600">
                              処理完了: <span className="font-semibold text-green-700">{info?.processed}件</span>
                              <span className="mx-1 text-cream-400">/</span>
                              母数: <span className="font-semibold">{info?.submitted}件</span>
                            </span>
                            {diff > 0 ? (
                              <span className="flex items-center gap-1 text-amber-600 font-semibold">
                                <AlertTriangle size={12} /> 差分: {diff}件 未処理
                              </span>
                            ) : (
                              <span className="text-green-600">✓ 差分なし</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {session?.status === 'completed' && (
              <div className="flex justify-center pt-4 pb-2">
                <button onClick={endSession}
                  className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent-dark text-white text-sm rounded-xl font-heading font-bold transition-colors shadow-md">
                  <ArrowLeft size={18} /> ダッシュボードに戻る
                </button>
              </div>
            )}
          </>
        ) : (
          /* ===== default layout: two-column grid ===== */
          <div className="grid grid-cols-12 gap-6">
            {/* Left: Calendar */}
            <div className="col-span-4">
              <div className="bg-white rounded-xl border border-cream-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))} className="p-1 rounded hover:bg-cream-100 text-cream-500"><ChevronLeft size={18} /></button>
                  <span className="font-heading font-semibold text-sm text-cream-800">{calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月</span>
                  <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))} className="p-1 rounded hover:bg-cream-100 text-cream-500"><ChevronRight size={18} /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center mb-2">
                  {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                    <span key={d} className={`text-xs font-body ${i === 0 || i === 6 ? 'text-red-400' : 'text-cream-400'}`}>{d}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">{renderCalendar()}</div>
                <div className="mt-4 pt-4 border-t border-cream-100">
                  <p className="text-xs font-body text-cream-600 mb-1">選択日: {formatDate(selectedDate)}</p>
                  <p className="text-xs font-body text-cream-500">倉庫: {getWarehouse(selectedDate, holidays, warehouseOverrides).name}</p>
                </div>
                {!session && (profile?.role === 'admin' || profile?.role === 'operator') && (
                  <button onClick={() => setShowSessionModal(true)}
                    className="mt-4 w-full bg-accent hover:bg-accent-dark text-white font-heading font-semibold text-sm py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
                    <Plus size={16} /> 新規セッション開始
                  </button>
                )}
              </div>
            </div>

            {/* Right: Status + Tasks */}
            <div className="col-span-8">
              {session && (
                <>
                  <div className="grid grid-cols-5 gap-3 mb-5">
                    <StatCard label="受注数" value={orders.length} />
                    <StatCard label="新規" value={session.newOrderCount} sub="件" color="text-blue-600" />
                    <StatCard label="既存" value={session.existingOrderCount} sub="件" color="text-cream-600" />
                    <StatCard label="完了タスク" value={completedCount} sub={`/${TASK_LIST.length}`} />
                    <StatCard label="検出アラート" value={alertCount} color="text-amber-600" />
                  </div>
                  <div className="bg-white rounded-xl border border-cream-200 p-2 mb-5 shadow-sm">
                    <div className="h-2 bg-cream-100 rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${(completedCount / TASK_LIST.length) * 100}%` }} />
                    </div>
                  </div>
                </>
              )}
              {/* Sequential Task Stepper */}
              {(() => {
                const nextPendingIdx = session ? TASK_LIST.findIndex((t) => taskStatuses[t.id] === 'pending') : -1;
                return (
                  <div className="bg-white rounded-xl border border-cream-200 shadow-sm overflow-hidden">
                    {TASK_LIST.map((task, idx) => {
                      const status = taskStatuses[task.id];
                      const count = taskResults[task.id]?.length;
                      const Icon = task.icon;
                      const isDone = status === 'completed' || status === 'skipped';
                      const isActive = session && idx === nextPendingIdx && !allTasksDone;
                      const isLocked = session && !isDone && !isActive;
                      const isClickable = session && (isDone || isActive) && !allTasksDone;
                      return (
                        <button key={task.id} disabled={!isClickable}
                          onClick={() => { if (isClickable) { setSelectedTask(task.id); setCurrentPage('taskDetail'); } }}
                          className={`w-full flex items-center gap-4 px-5 py-4 border-b border-cream-100 last:border-b-0 text-left transition-all
                            ${isActive ? 'bg-blue-50 hover:bg-blue-100' : isDone ? 'bg-cream-50 hover:bg-cream-100 cursor-pointer' : 'cursor-not-allowed'}
                            ${isLocked ? 'opacity-40' : ''}`}>
                          {/* Step badge */}
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all
                            ${status === 'completed' ? 'bg-green-500 text-white' : status === 'skipped' ? 'bg-cream-300 text-cream-600' : isActive ? 'bg-blue-600 text-white' : 'bg-cream-200 text-cream-500'}`}>
                            {status === 'completed' ? <CheckCircle2 size={18} /> : status === 'skipped' ? <SkipForward size={16} /> : idx + 1}
                          </div>
                          {/* Icon */}
                          <div className={`p-2 rounded-lg shrink-0 ${isActive ? 'bg-blue-100 text-blue-600' : isDone ? 'bg-green-50 text-green-500' : 'bg-cream-100 text-cream-400'}`}>
                            <Icon size={18} />
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className={`font-bold text-sm ${isActive ? 'text-blue-900' : isDone ? 'text-cream-600' : 'text-cream-800'}`}>{task.label}</p>
                            {session && count !== undefined && (
                              <p className="text-xs text-cream-500 mt-0.5">
                                {count > 0 ? <span className="text-amber-600 font-semibold">{count}件 検出</span> : <span className="text-green-600">問題なし</span>}
                              </p>
                            )}
                          </div>
                          {/* Right indicator */}
                          {isActive && <ChevronRight size={18} className="text-blue-400 shrink-0" />}
                          {status === 'completed' && <span className="text-xs text-green-600 font-semibold shrink-0">完了</span>}
                          {status === 'skipped' && <span className="text-xs text-cream-400 shrink-0">スキップ</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ======================== Task Detail (task-specific UIs) ========================
  const renderTaskDetail = () => {
    const task = TASK_LIST.find((t) => t.id === selectedTask);
    if (!task) return null;
    const items = taskResults[task.id] || [];
    const status = taskStatuses[task.id];
    const Icon = task.icon;

    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-5xl mx-auto">
          <button onClick={() => { setCurrentPage('dashboard'); setSelectedTask(null); }}
            className="flex items-center gap-2 text-sm text-cream-500 hover:text-cream-700 mb-4 font-body transition-colors">
            <ArrowLeft size={16} /> ダッシュボードに戻る
          </button>
          <div className="bg-white rounded-xl border border-cream-200 shadow-sm">
            {/* Header */}
            <div className="p-5 border-b border-cream-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-cream-100 rounded-lg text-cream-700"><Icon size={22} /></div>
                <div>
                  <h3 className="font-heading font-bold text-lg text-cream-900">{task.label}</h3>
                  <p className="text-xs font-body text-cream-500">{items.length}件の受注が対象</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* 住所校正タスク専用: 一括校正ボタン */}
                {task.id === 'addressCorrection' && status === 'pending' && items.length > 0 && (
                  <button onClick={() => runAddressCorrection(items)} disabled={addressLoading}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-heading font-semibold transition-colors disabled:opacity-50">
                    <Zap size={14} /> {addressLoading ? '校正中...' : 'AI校正を実行'}
                  </button>
                )}
                {status === 'pending' && (
                  <>
                    <button onClick={() => skipTask(task.id)} className="flex items-center gap-1.5 px-4 py-2 bg-cream-100 hover:bg-cream-200 text-cream-600 text-sm rounded-lg font-body transition-colors">
                      <SkipForward size={14} /> スキップ
                    </button>
                    <button onClick={() => completeTask(task.id)} className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-dark text-white text-sm rounded-lg font-heading font-semibold transition-colors">
                      <CheckCircle2 size={14} /> 完了
                    </button>
                  </>
                )}
                {status === 'completed' && <span className="flex items-center gap-1.5 text-green-600 text-sm font-body"><CheckCircle2 size={16} /> 完了済み</span>}
                {status === 'skipped' && <span className="flex items-center gap-1.5 text-cream-400 text-sm font-body"><SkipForward size={16} /> スキップ済み</span>}
              </div>
            </div>

            {/* Body: Task-specific rendering */}
            {task.id === 'pendingShipment'
              ? renderPendingShipmentTable()
              : items.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 size={40} className="mx-auto text-green-400 mb-3" />
                <p className="font-body text-cream-600">対象の受注はありません</p>
              </div>
            ) : task.id === 'addressCorrection' ? renderAddressCorrectionTable(items)
              : task.id === 'duplicate' ? renderDuplicateTable(items)
              : task.id === 'nameAnomaly' ? renderNameAnomalyTable(items)
              : task.id === 'purchaseUrl' ? renderPurchaseUrlTable(items)
              : task.id === 'singleItem' ? renderSingleItemTable(items)
              : task.id === 'oplux' ? renderOpluxTable(items)
              : task.id === 'npPayment' ? renderNpBessoTable(items)
              : task.id === 'paymentError' ? renderPaymentErrorTable(items)
              : renderGenericTable(items, task.id)
            }
          </div>
        </div>
      </div>
    );
  };

  // --- 住所校正タスク専用カードUI ---
  const renderAddressCorrectionTable = (items) => {
    const formatZip = (zip) => {
      const z = String(zip || '').replace(/[^0-9]/g, '');
      return z.length === 7 ? `〒${z.slice(0, 3)}-${z.slice(3)}` : zip ? `〒${zip}` : '';
    };
    // フル住所を組み立て（address フィールド優先、なければ個別フィールドを結合）
    const assembleAddr = (c) => {
      if (c.address) return c.address;
      if (c.corrected_address) return c.corrected_address;
      const street = [c.town, c.chome, c.banchi, c.go].filter(Boolean).join('');
      const building = [c.building, c.building_number].filter(Boolean).join(' ');
      return `${c.prefecture || ''}${c.city || ''}${street}${building ? ' ' + building : ''}`.trim();
    };
    const corrected = items.filter((o) => addressResults[o.id]?.correction);
    const withChange = items.filter((o) => hasAddressChange(o, addressResults[o.id]?.correction));

    const toggleSelect = (id) => {
      setAddressSelection((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    };
    const selectAll = () => setAddressSelection(new Set(corrected.map((o) => o.id)));
    const clearAll = () => setAddressSelection(new Set());

    const ScoreBadge = ({ score }) => {
      if (score === 'OK')     return <span className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded text-xs font-semibold">OK</span>;
      if (score === 'NG')     return <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-xs font-semibold">NG</span>;
      return <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold">Review</span>;
    };

    return (
      <div className="p-4 space-y-4">
        {/* スコア凡例 */}
        <div className="bg-cream-50 rounded-xl p-4 border border-cream-100 space-y-1.5">
          <p className="text-xs font-heading font-semibold text-cream-500 mb-2">スコアの見方</p>
          {[
            { score: 'OK', label: '都道府県〜号・建物まで入力された、配送に適した住所。' },
            { score: 'Review',  label: '補完や推定が多く曖昧、配送に注意が必要。' },
            { score: 'NG', label: '市区町村以下に不備多く、配送リスク高い。' },
          ].map(({ score, label }) => (
            <div key={score} className="flex items-center gap-2 text-sm">
              <ScoreBadge score={score} />
              <span className="text-cream-600">{label}</span>
            </div>
          ))}
        </div>

        {/* 進捗バー */}
        {addressProgress && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-body text-cream-600">
              <span>AI校正中... {addressProgress.completed}/{addressProgress.total}件</span>
              <span>{Math.round((addressProgress.completed / addressProgress.total) * 100)}%</span>
            </div>
            <div className="h-2 bg-cream-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${(addressProgress.completed / addressProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* サマリー + 操作ボタン */}
        {corrected.length > 0 && (
          <div className="flex items-center justify-between">
            <div>
              <p className="font-heading font-semibold text-cream-800">{corrected.length}件校正完了</p>
              {withChange.length > 0 && (
                <p className="text-sm text-cream-500">{withChange.length}件に修正あり（自動選択済み）</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={addressSelection.size === corrected.length ? clearAll : selectAll}
                className="px-3 py-1.5 text-sm border border-cream-200 rounded-lg hover:bg-cream-50 font-body text-cream-700 transition-colors">
                {addressSelection.size === corrected.length ? '全解除' : '全選択'}
              </button>
              <button onClick={() => runAddressCorrection(items)} disabled={addressLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-cream-200 rounded-lg hover:bg-cream-50 font-body text-cream-700 disabled:opacity-50 transition-colors">
                <RefreshCw size={13} className={addressLoading ? 'animate-spin' : ''} /> やり直し
              </button>
            </div>
          </div>
        )}

        {/* 受注カード一覧 */}
        <div className="space-y-3">
          {items.map((order) => {
            const ar = addressResults[order.id];
            const addr = order.shipping_address;
            const selected = addressSelection.has(order.id);
            const c = ar?.correction;
            const score = c?.score || 'OK';
            const change = c ? (typeof c.changed === 'boolean' ? c.changed : hasAddressChange(order, c)) : false;
            const has_warning = score === 'NG' || score === 'Review';
            const origZip = formatZip(addr?.zip);
            const origAddr = `${addr?.prefecture || ''}${addr?.city || ''}${addr?.street || ''} ${addr?.building || ''}`.trim();
            const corrZip = c ? formatZip(c.corrected_zip || addr?.zip) : origZip;
            const corrAddr = c ? assembleAddr(c) : origAddr;
            const ecforceUrl = apiConfig?.ecforceBaseUrl
              ? `${apiConfig.ecforceBaseUrl.replace(/\/api.*$/, '')}/admin/orders/${order.id}`
              : '#';

            return (
              <div key={order.id}
                className={`rounded-xl border-2 p-4 transition-colors ${selected ? 'border-accent/50 bg-accent/5' : 'border-cream-200 bg-white'}`}>
                {/* ヘッダー行 */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <button onClick={() => c && toggleSelect(order.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-accent border-accent text-white' : c ? 'border-cream-300 hover:border-accent' : 'border-cream-200 opacity-30 cursor-not-allowed'}`}>
                    {selected && <Check size={11} />}
                  </button>
                  <span className="font-mono font-semibold text-cream-900 text-sm">
                    受注番号: <span className="text-accent">{order.number}</span>
                  </span>
                  <span className="text-cream-400 text-xs">顧客ID: {order.customer_id || order.customer_number || '-'}</span>
                  {c && <ScoreBadge score={score} />}
                  {change && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded font-semibold">修正あり</span>}
                  {has_warning && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded font-semibold">
                      <AlertTriangle size={10} /> 要注意
                    </span>
                  )}
                  {ar?.applied && <span className="text-xs text-green-600 font-semibold">✓ 反映済み</span>}
                  <a href={ecforceUrl} target="_blank" rel="noopener noreferrer"
                    className="ml-auto text-cream-300 hover:text-accent transition-colors">
                    <ExternalLink size={15} />
                  </a>
                </div>

                {/* 住所詳細 */}
                <div className="ml-7 space-y-1 text-sm">
                  {/* 元の住所は常に表示 */}
                  <div className="flex gap-2">
                    <span className="text-cream-400 w-16 shrink-0">{c ? '元の住所' : '住所'}</span>
                    <span className="text-cream-700">{origZip} {origAddr}</span>
                  </div>
                  {ar?.error ? (
                    <p className="text-red-500">{ar.error}</p>
                  ) : c ? (
                    <>
                      <div className="flex gap-2">
                        <span className="text-cream-400 w-16 shrink-0">校正後</span>
                        <span className={change ? 'text-blue-600 font-semibold' : 'text-cream-700'}>{corrZip} {corrAddr}</span>
                      </div>
                      {change && c.reason && (
                        <div className="flex gap-2">
                          <span className="text-cream-400 w-16 shrink-0">修正理由</span>
                          <span className="text-blue-600">{c.reason}</span>
                        </div>
                      )}
                      {has_warning && c.score_reason && (
                        <div className="flex gap-2">
                          <span className="text-red-500 w-16 shrink-0">要注意</span>
                          <span className="text-red-600">{c.score_reason}</span>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* 一括反映 固定フッター */}
        {addressSelection.size > 0 && (
          <div className="sticky bottom-0 -mx-4 px-4 pb-4 pt-2 bg-gradient-to-t from-white via-white to-transparent">
            <button
              onClick={() => bulkApplyAddressesToEcforce([...addressSelection])}
              disabled={addressApplying}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-heading font-bold rounded-xl transition-colors shadow-lg">
              {addressApplying ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ecforceに反映中...
                </>
              ) : (
                <><Check size={18} /> 選択した{addressSelection.size}件をecforceに書き戻す</>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  // --- 重複注文タスク専用テーブル ---
  const renderDuplicateTable = (items) => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
    // グループ化（氏名 + 郵便番号 をキーに同一枠でまとめる）
    const groups = {};
    items.forEach((o) => {
      const key = `${o.shipping_address?.family_name}${o.shipping_address?.given_name}_${o.shipping_address?.zip}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });

    return (
      <div className="p-4 space-y-4">
        {Object.entries(groups).map(([key, groupOrders]) => {
          const firstAddr = groupOrders[0]?.shipping_address || {};
          return (
            <div key={key} className="border border-red-200 rounded-lg overflow-hidden">
              <div className="bg-red-50 px-4 py-2 flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-500" />
                <span className="text-sm font-heading font-semibold text-red-700">
                  重複グループ: {firstAddr.family_name} {firstAddr.given_name}
                  {firstAddr.zip && <span className="ml-2 font-normal text-red-500 text-xs">〒{firstAddr.zip}</span>}
                  <span className="ml-2">（{groupOrders.length}件）</span>
                </span>
              </div>
              <table className="w-full">
                <thead><tr className="bg-cream-50 text-left">
                  <th className="px-3 py-2 text-xs font-heading text-cream-500 w-8"></th>
                  <th className="px-3 py-2 text-xs font-heading text-cream-500">受注ID</th>
                  <th className="px-3 py-2 text-xs font-heading text-cream-500">住所</th>
                  <th className="px-3 py-2 text-xs font-heading text-cream-500">決済</th>
                  <th className="px-3 py-2 text-xs font-heading text-cream-500">商品</th>
                  <th className="px-3 py-2 text-xs font-heading text-cream-500"></th>
                </tr></thead>
                <tbody>
                  {groupOrders.map((o) => {
                    const os = orderStatuses[o.id] || {};
                    const adminUrl = ecBase ? `${ecBase}/admin/orders/${o.id}` : '#';
                    return (
                      <tr key={o.id} className={`border-t border-cream-100 ${os.checked ? 'bg-green-50/40' : ''}`}>
                        <td className="px-3 py-2">
                          <button onClick={() => toggleOrderChecked(o.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${os.checked ? 'bg-green-500 border-green-500 text-white' : 'border-cream-300 hover:border-accent'}`}>
                            {os.checked && <Check size={12} />}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <a href={adminUrl} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                            {o.id}<ExternalLink size={11} className="opacity-60" />
                          </a>
                        </td>
                        <td className="px-3 py-2 text-sm font-body text-cream-600">{o.shipping_address?.prefecture}{o.shipping_address?.city}{o.shipping_address?.street}</td>
                        <td className="px-3 py-2 text-sm font-body text-cream-600">{o.payment_method_name}</td>
                        <td className="px-3 py-2 text-xs font-body text-cream-600">{o.line_items?.map((i) => i.name).join(', ')}</td>
                        <td className="px-3 py-2">
                          <a href={adminUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-cream-100 hover:bg-cream-200 text-cream-700 rounded transition-colors font-body whitespace-nowrap">
                            <ExternalLink size={11} /> 管理画面
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  };

  // --- 決済エラー確認専用テーブル ---
  const renderPaymentErrorTable = (items) => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-cream-50 text-left">
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500 w-8"></th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">受注ID</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">氏名</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">値段</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">支払い方法</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">決済状況</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">エラー内容</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => {
              const os = orderStatuses[order.id] || {};
              const addr = order.shipping_address || {};
              const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
              const amount = order.total ?? order.charge ?? order.subtotal ?? null;
              return (
                <tr key={order.id} className={`border-t border-cream-100 transition-colors ${os.checked ? 'bg-green-50/40' : 'hover:bg-cream-50/50'}`}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleOrderChecked(order.id)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${os.checked ? 'bg-green-500 border-green-500 text-white' : 'border-cream-300 hover:border-accent'}`}>
                      {os.checked && <Check size={12} />}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                      {order.id}<ExternalLink size={11} className="opacity-60" />
                    </a>
                  </td>
                  <td className="px-3 py-2 text-sm font-body text-cream-800">{addr.family_name} {addr.given_name}</td>
                  <td className="px-3 py-2 text-sm font-mono text-cream-700">
                    {amount != null ? `¥${Number(amount).toLocaleString()}` : '-'}
                  </td>
                  <td className="px-3 py-2 text-sm font-body text-cream-600">{order.payment_method_name || '-'}</td>
                  <td className="px-3 py-2 text-sm font-body text-cream-600">{order.payment_human_state || '-'}</td>
                  <td className="px-3 py-2 text-xs font-mono text-red-700 max-w-[220px] break-words">
                    {order.payment_last_error_message || order.payment_state || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setHoldDialog({ order, doHold: true, doSuspendSubs: !!order.subs_order_id, mailTemplateId: '' })}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-lg font-heading font-semibold transition-colors whitespace-nowrap">
                      <Pause size={12} /> 保留処理
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderGenericTable = (items, taskId) => (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-cream-50 text-left">
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500 w-8"></th>
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">受注ID</th>
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">氏名</th>
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">住所</th>
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">決済</th>
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">ステータス</th>
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">判定</th>
            <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">メモ</th>
          </tr>
        </thead>
        <tbody>
          {items.map((order) => {
            const os = orderStatuses[order.id] || {};
            return (
              <tr key={order.id} className={`border-t border-cream-100 transition-colors ${os.checked ? 'bg-green-50/40' : 'hover:bg-cream-50/50'}`}>
                <td className="px-3 py-3">
                  <button onClick={() => toggleOrderChecked(order.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${os.checked ? 'bg-green-500 border-green-500 text-white' : 'border-cream-300 hover:border-accent'}`}>
                    {os.checked && <Check size={12} />}
                  </button>
                </td>
                <td className="px-3 py-3 text-sm font-mono text-accent">{order.id}</td>
                <td className="px-3 py-3 text-sm font-body text-cream-800">{order.shipping_address?.family_name} {order.shipping_address?.given_name}</td>
                <td className="px-3 py-3 text-sm font-body text-cream-600 max-w-[180px] truncate">{order.shipping_address?.prefecture}{order.shipping_address?.city}{order.shipping_address?.street}</td>
                <td className="px-3 py-3 text-sm font-body text-cream-600">{order.payment_method_name}</td>
                <td className="px-3 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-body
                    ${order.payment_state === 'paid' ? 'bg-green-100 text-green-700' : ''}
                    ${order.payment_state === 'failed' || order.payment_state === 'error' ? 'bg-red-100 text-red-700' : ''}
                    ${order.payment_state === 'pending' ? 'bg-amber-100 text-amber-700' : ''}`}>
                    {order.payment_state}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <select value={os.status || 'pending'} onChange={(e) => setOrderStatus(order.id, 'status', e.target.value)}
                    className="text-xs border border-cream-200 rounded px-1.5 py-1 font-body text-cream-700 bg-white focus:outline-none focus:ring-1 focus:ring-accent/30">
                    <option value="pending">未確認</option>
                    <option value="ok">問題なし</option>
                    <option value="issue">要対応</option>
                  </select>
                </td>
                <td className="px-3 py-3">
                  <input type="text" value={os.memo || ''} onChange={(e) => setOrderStatus(order.id, 'memo', e.target.value)}
                    placeholder="メモ" className="w-full px-2 py-1 text-xs border border-cream-200 rounded font-body text-cream-700 focus:outline-none focus:ring-1 focus:ring-accent/30" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // --- 氏名異常タスク専用カードUI ---
  const renderNameAnomalyTable = (items) => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
    const pendingItems = items.filter((o) => !nameEditedIds.has(o.id));
    const processedItems = items.filter((o) => nameEditedIds.has(o.id));

    // O-PLUX振り仮名誤り判定（同じ正規表現を使用）
    const isOpluxKanaError = (order) => /振り仮名|フリガナ|ふりがな|カナ不一致|カナ相違|kana/i.test(String(order.o_plux_description || ''));

    const renderCard = (order, isProcessed = false) => {
      const addr = order.shipping_address || {};
      const result = judgePersonName({ name01: addr.family_name, name02: addr.given_name, full_name: addr.full_name });
      const isTest = result.reasons.some((r) => r.includes('TEST_WORD') || r.includes('ONLY_DIGITS') || r.includes('ONLY_SYMBOLS') || r.includes('EMOJI'));
      // judgePersonName では異常なし → O-PLUX振り仮名誤りのケース
      const isKanaError = !result.abnormal && isOpluxKanaError(order);
      const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';

      if (isProcessed) {
        return (
          <div key={order.id} className="rounded-xl border border-green-200 bg-green-50/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-xs font-heading font-bold bg-green-100 text-green-700">修正済み</span>
                <span className="font-mono text-sm text-accent font-semibold">受注ID: {order.id}</span>
                <span className="text-sm font-body text-cream-800 font-semibold">{addr.family_name} {addr.given_name}</span>
                {(addr.kana01 || addr.kana02) && (
                  <span className="text-xs text-cream-500">（{addr.kana01} {addr.kana02}）</span>
                )}
              </div>
              <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-cream-300 hover:text-accent transition-colors shrink-0">
                <ExternalLink size={15} />
              </a>
            </div>
          </div>
        );
      }

      // O-PLUX振り仮名誤りカード
      if (isKanaError) {
        return (
          <div key={order.id} className="rounded-xl border-2 border-purple-200 bg-purple-50/30 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-xs font-heading font-bold bg-purple-100 text-purple-700">
                  O-PLUX振り仮名
                </span>
                <span className="font-mono text-sm text-accent font-semibold">受注ID: {order.id}</span>
              </div>
              <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-cream-300 hover:text-accent transition-colors shrink-0">
                <ExternalLink size={15} />
              </a>
            </div>
            <div className="mb-3 space-y-1 text-sm font-body">
              <p className="text-cream-800">
                <span className="font-semibold">{addr.family_name} {addr.given_name}</span>
                {(addr.kana01 || addr.kana02) && (
                  <span className="ml-2 text-cream-500">（{addr.kana01} {addr.kana02}）</span>
                )}
              </p>
              <div className="flex gap-4 text-xs font-body text-cream-500">
                {(order.charge || order.total) != null && (
                  <span>金額: ¥{(order.charge || order.total || 0).toLocaleString()}</span>
                )}
                {order.completed_at && (
                  <span>受注日: {new Date(order.completed_at).toLocaleString('ja-JP')}</span>
                )}
              </div>
              {order.o_plux_description && (
                <p className="text-xs font-body text-purple-700 bg-purple-100 rounded px-2 py-1 mt-1 break-all">
                  O-PLUX詳細: {order.o_plux_description}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setNameEditDialog({ order })}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded-lg font-heading font-semibold transition-colors">
                <Edit3 size={13} /> 振り仮名を修正
              </button>
            </div>
          </div>
        );
      }

      return (
        <div key={order.id} className={`rounded-xl border-2 p-4 ${isTest ? 'border-red-200 bg-red-50/30' : 'border-orange-200 bg-orange-50/30'}`}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-heading font-bold ${isTest ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                {isTest ? 'テスト注文' : '氏名不備'}
              </span>
              <span className="font-mono text-sm text-accent font-semibold">受注ID: {order.id}</span>
            </div>
            <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-cream-300 hover:text-accent transition-colors shrink-0">
              <ExternalLink size={15} />
            </a>
          </div>
          <div className="mb-3">
            <p className="text-sm font-body text-cream-800">
              <span className="font-semibold">{addr.family_name} {addr.given_name}</span>
              {(addr.kana01 || addr.kana02) && (
                <span className="ml-2 text-cream-500">（{addr.kana01} {addr.kana02}）</span>
              )}
            </p>
            <div className="flex gap-4 mt-1 text-xs font-body text-cream-500">
              {(order.charge || order.total) != null && (
                <span>金額: ¥{(order.charge || order.total || 0).toLocaleString()}</span>
              )}
              {order.completed_at && (
                <span>受注日: {new Date(order.completed_at).toLocaleString('ja-JP')}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {result.reasons.map((r, i) => (
                <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${isTest ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{r}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setNameEditDialog({ order })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg font-heading font-semibold transition-colors">
              <Edit3 size={13} /> 修正
            </button>
            <button onClick={() => setCancelConfirmDialog({ order, doOrder: true, doPayment: true, doSubs: !!order.subs_order_id })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg font-heading font-semibold transition-colors">
              <Ban size={13} /> テスト受注キャンセル
            </button>
          </div>
        </div>
      );
    };

    return (
      <div className="p-4 space-y-3">
        {pendingItems.map((order) => renderCard(order, false))}
        {processedItems.length > 0 && (
          <>
            <div className="pt-2 pb-1 flex items-center gap-2">
              <div className="flex-1 h-px bg-green-200" />
              <span className="text-xs font-heading font-semibold text-green-600 px-2">処理済み（{processedItems.length}件）</span>
              <div className="flex-1 h-px bg-green-200" />
            </div>
            {processedItems.map((order) => renderCard(order, true))}
          </>
        )}
      </div>
    );
  };

  // --- 購入URL確認タスク専用カードUI ---
  const renderPurchaseUrlTable = (items) => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
    return (
      <div className="p-4 space-y-3">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm font-body text-orange-800 mb-2">
          <p className="font-heading font-semibold mb-1">購入URL確認</p>
          <p className="text-xs">初回受注のうち、購入URLに <mark className="bg-amber-200 text-amber-800 px-1 rounded">defo</mark> または <mark className="bg-amber-200 text-amber-800 px-1 rounded">test</mark> が含まれる受注です。テスト購入か確認してください。</p>
        </div>
        {items.map((order) => {
          const url = order.purchase_url || order.url || '';
          const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
          const amount = order.total ?? order.charge ?? order.subtotal ?? null;
          const completedAt = order.completed_at ? new Date(order.completed_at).toLocaleString('ja-JP') : '-';
          return (
            <div key={order.id} className="rounded-xl border-2 border-orange-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 text-sm font-body flex-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-orange-500 shrink-0" />
                    <span className="font-heading font-semibold text-cream-800">受注ID: <span className="font-mono text-accent">{order.id}</span></span>
                  </div>
                  <div className="text-xs text-cream-700 pl-5 space-y-0.5">
                    <div>購入URL: <span className="font-mono">
                      {url.split(/(defo|test)/i).map((part, i) =>
                        /defo|test/i.test(part)
                          ? <mark key={i} className="bg-amber-300 text-amber-900 px-0.5 rounded font-bold">{part}</mark>
                          : part
                      )}
                    </span></div>
                    <div>顧客ID: <span className="font-mono">{order.customer_id ?? '-'}</span></div>
                    {amount != null && <div>金額: <span className="font-mono">¥{amount.toLocaleString()}</span></div>}
                    <div>受注日: <span className="font-mono">{completedAt}</span></div>
                  </div>
                </div>
                <a href={adminUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg font-heading font-semibold transition-colors">
                  詳細確認 <ExternalLink size={11} />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // --- 単品注文確認タスク専用テーブル ---
  const renderSingleItemTable = (items) => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-cream-50 text-left">
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">受注ID</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">顧客ID</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">氏名</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">郵便番号</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">住所</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">商品コード</th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => {
              const addr = order.shipping_address || {};
              const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
              const productCodes = (order.line_items || []).map((i) => i.product_code).filter(Boolean);
              const fullAddress = `${addr.prefecture || ''}${addr.city || ''}${addr.street || ''}${addr.building ? ' ' + addr.building : ''}`.trim();
              return (
                <tr key={order.id} className="border-t border-cream-100 hover:bg-cream-50/50 transition-colors">
                  <td className="px-3 py-3">
                    <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                      {order.id}<ExternalLink size={11} className="opacity-60" />
                    </a>
                  </td>
                  <td className="px-3 py-3 text-xs font-mono text-cream-600">{order.customer_id || '-'}</td>
                  <td className="px-3 py-3 text-sm font-body text-cream-800">{addr.family_name} {addr.given_name}</td>
                  <td className="px-3 py-3 text-xs font-mono text-cream-600">{addr.zip || '-'}</td>
                  <td className="px-3 py-3 text-xs font-body text-cream-600 max-w-[200px]">{fullAddress}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {productCodes.map((c, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-mono">{c}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // --- NP別送確認テーブル ---
  const renderNpBessoTable = (items) => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-cream-50 text-left">
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">受注ID</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">メールアドレス</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">支払方法ID</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">合計金額</th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => {
              const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
              return (
                <tr key={order.id} className="border-t border-cream-100 hover:bg-cream-50/50 transition-colors">
                  <td className="px-3 py-3">
                    <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                      {order.id}<ExternalLink size={11} className="opacity-60" />
                    </a>
                  </td>
                  <td className="px-3 py-3 text-sm font-body text-cream-700">{order.email || '-'}</td>
                  <td className="px-3 py-3 text-xs font-mono text-cream-600">{order.payment_method_id ?? '-'}</td>
                  <td className="px-3 py-3 text-sm font-mono text-cream-800">¥{(order.total_price || order.subtotal || 0).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // --- O-PLUX審査確認カードUI ---
  const renderOpluxTable = (items) => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';
    const highlight = (text) => {
      if (!text || opluxKeywords.length === 0) return text;
      const escaped = opluxKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
      return String(text).split(pattern).map((part, i) =>
        pattern.test(part) ? <mark key={i} className="bg-red-200 text-red-900 px-0.5 rounded font-semibold">{part}</mark> : part
      );
    };
    return (
      <div className="p-4 space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm font-body text-amber-800 mb-2">
          <p className="font-heading font-semibold mb-1">O-PLUX審査確認</p>
          <p className="text-xs">初回受注でO-PLUXのREVIEW / OK判定が出た受注です。登録キーワードが赤くハイライトされます。</p>
        </div>
        {items.map((order) => {
          const addr = order.shipping_address || {};
          const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
          const opluxResult = String(order.o_plux_result || '').toUpperCase();
          const opluxDesc = order.o_plux_description || '';
          const shippingName = [addr.family_name, addr.given_name].filter(Boolean).join(' ');
          const shippingAddr = [addr.prefecture, addr.city, addr.street, addr.building].filter(Boolean).join('');
          const isReview = opluxResult === 'REVIEW';
          // 住所校正結果
          const ar = addressResults[order.id];
          const c = ar?.correction;
          const correctedAddrStr = c
            ? [
                addr.prefecture,
                c.corrected_addr01 || `${c.city || ''}${c.town || ''}`.trim(),
                c.corrected_addr02 || '',
              ].filter(Boolean).join('')
            : null;
          return (
            <div key={order.id} className={`rounded-xl border-2 bg-white p-4 ${isReview ? 'border-red-200' : 'border-amber-200'}`}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-heading font-bold ${isReview ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {opluxResult || '-'}
                  </span>
                  <span className="font-mono text-sm text-accent font-semibold">受注ID: {order.id}</span>
                </div>
                <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-cream-300 hover:text-accent transition-colors shrink-0">
                  <ExternalLink size={15} />
                </a>
              </div>
              <div className="space-y-1 text-xs font-body">
                <div className="flex gap-2">
                  <span className="text-cream-400 w-20 shrink-0">顧客ID</span>
                  <span className="font-mono text-cream-700">{order.customer_id ?? '-'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-cream-400 w-20 shrink-0">配送先氏名</span>
                  <span className="text-cream-700">{highlight(shippingName) || '-'}</span>
                </div>
                {/* 配送先住所: 住所校正結果に応じて表示切り替え */}
                {ar?.applied ? (
                  <div className="flex gap-2">
                    <span className="text-cream-400 w-20 shrink-0">配送先住所</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-cream-700 break-all">{highlight(correctedAddrStr) || '-'}</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-heading font-bold bg-green-100 text-green-700 shrink-0">住所校正済み</span>
                      </div>
                      <div className="text-[10px] text-cream-400 break-all line-through">{shippingAddr}</div>
                    </div>
                  </div>
                ) : correctedAddrStr ? (
                  <div className="flex gap-2">
                    <span className="text-cream-400 w-20 shrink-0">配送先住所</span>
                    <div className="flex-1">
                      <div className="text-[10px] text-cream-400 break-all mb-0.5">{shippingAddr}（元住所）</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-cream-700 break-all">{highlight(correctedAddrStr) || '-'}</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-heading font-bold bg-amber-100 text-amber-700 shrink-0">住所校正あり</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <span className="text-cream-400 w-20 shrink-0">配送先住所</span>
                    <span className="text-cream-700 break-all">{highlight(shippingAddr) || '-'}</span>
                  </div>
                )}
                {opluxResult && <div className="flex gap-2">
                  <span className="text-cream-400 w-20 shrink-0">審査結果</span>
                  <span className="font-mono text-cream-700">{opluxResult}</span>
                </div>}
                {opluxDesc && <div className="flex gap-2">
                  <span className="text-cream-400 w-20 shrink-0">審査詳細</span>
                  <span className="text-cream-700 break-all">{highlight(opluxDesc)}</span>
                </div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // --- 過去出荷分確認テーブル ---
  const renderPendingShipmentTable = () => {
    const ecBase = apiConfig?.ecforceBaseUrl?.replace(/\/api.*$/, '') || '';

    // 取得中
    if (pendingShipmentLoading) {
      return (
        <div className="p-12 text-center">
          <div className="w-10 h-10 border-4 border-cream-200 border-t-accent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm font-body text-cream-500">過去出荷分を取得中...</p>
        </div>
      );
    }

    // 0件: 他タスクと同じシンプル表示
    if (pendingShipmentOrders.length === 0) {
      return (
        <div className="p-12 text-center">
          <CheckCircle2 size={40} className="mx-auto text-green-400 mb-3" />
          <p className="font-body text-cream-600">対象の受注はありません</p>
        </div>
      );
    }

    // 1件以上: テーブル表示
    return (
      <div className="overflow-x-auto">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <p className="text-xs font-body text-cream-500">
            過去15日間の未出荷・仮売上受注（shipped_at=null, tbc=false）— {pendingShipmentOrders.length}件
          </p>
          <button onClick={fetchPendingShipments} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-dark font-body transition-colors">
            <RefreshCw size={12} /> 再取得
          </button>
        </div>
        {session?.date && (
          <div className="px-4 pb-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs font-body text-blue-700 flex items-center gap-2">
              <Info size={13} className="shrink-0" />
              「当日に変更」で発送予定日を <span className="font-mono font-semibold mx-1">{session.date}</span> に更新し、出荷リストへ追加します。
            </div>
          </div>
        )}
        <table className="w-full">
          <thead>
            <tr className="bg-cream-50 text-left">
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">受注ID</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">氏名</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500">出荷予定日</th>
              <th className="px-3 py-3 text-xs font-heading font-semibold text-cream-500"></th>
            </tr>
          </thead>
          <tbody>
            {pendingShipmentOrders.map((order) => {
              const adminUrl = ecBase ? `${ecBase}/admin/orders/${order.id}` : '#';
              const addr = order.shipping_address || {};
              const name = [addr.family_name, addr.given_name].filter(Boolean).join(' ') || '-';
              const isMoved = pendingMovedIds.has(order.id);
              const isChanging = pendingDateChangingIds.has(order.id);
              return (
                <tr key={order.id} className={`border-t border-cream-100 transition-colors ${isMoved ? 'bg-green-50/60' : 'hover:bg-cream-50/50'}`}>
                  <td className="px-3 py-3">
                    <a href={adminUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-accent hover:underline flex items-center gap-1">
                      {order.id}<ExternalLink size={11} className="opacity-60" />
                    </a>
                  </td>
                  <td className="px-3 py-3 text-sm font-body text-cream-800">{name}</td>
                  <td className="px-3 py-3 text-xs font-mono text-cream-600">
                    {isMoved ? (
                      <span className="text-green-700 font-semibold">{session.date} <span className="text-green-500">（変更済）</span></span>
                    ) : (
                      order.scheduled_to_be_shipped_at || '-'
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {isMoved ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-body font-semibold">
                        <CheckCircle2 size={13} /> 出荷リスト追加済
                      </span>
                    ) : session?.date ? (
                      <button
                        onClick={() => handleMovePendingToSession(order)}
                        disabled={isChanging}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-dark text-white text-xs rounded-lg font-heading font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ml-auto"
                      >
                        {isChanging ? (
                          <><RefreshCw size={11} className="animate-spin" /> 処理中...</>
                        ) : (
                          <><Truck size={11} /> 当日に変更</>
                        )}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ======================== Warehouse Calendar (with override) ========================
  const renderWarehouseCalendar = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const toggleOverride = async (date) => {
      if (profile?.role !== 'admin') return;
      const ds = formatDate(date);
      const current = getWarehouse(date, holidays, {});
      const overrideTarget = current.id === 'tsukamoto' ? { id: 'fj_logi', name: 'FJロジ' } : { id: 'tsukamoto', name: '塚本郵便逓送' };
      const newOverrides = { ...warehouseOverrides };
      if (newOverrides[ds]) delete newOverrides[ds];
      else newOverrides[ds] = overrideTarget;
      setWarehouseOverrides(newOverrides);
      await setAppSettings('warehouse_overrides', { overrides: newOverrides });
      showToast(`${ds} の倉庫を変更しました`, 'success');
    };

    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-heading font-bold text-xl text-cream-900 mb-5">倉庫カレンダー</h2>
          {profile?.role === 'admin' && (
            <p className="text-xs font-body text-cream-500 mb-4">日付をクリックすると倉庫を手動で切り替えられます</p>
          )}
          <div className="bg-white rounded-xl border border-cream-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => setCalendarMonth(new Date(year, month - 1))} className="p-2 rounded-lg hover:bg-cream-100 text-cream-500"><ChevronLeft size={18} /></button>
              <span className="font-heading font-semibold text-cream-800">{year}年{month + 1}月</span>
              <button onClick={() => setCalendarMonth(new Date(year, month + 1))} className="p-2 rounded-lg hover:bg-cream-100 text-cream-500"><ChevronRight size={18} /></button>
            </div>
            <div className="grid grid-cols-7 gap-2">
              {['日', '月', '火', '水', '木', '金', '土'].map((d) => <div key={d} className="text-center text-xs font-body text-cream-400 pb-2">{d}</div>)}
              {Array.from({ length: new Date(year, month, 1).getDay() }, (_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const date = new Date(year, month, i + 1);
                const ds = formatDate(date);
                const wh = getWarehouse(date, holidays, warehouseOverrides);
                const isFJ = wh.id === 'fj_logi';
                const isOverridden = !!warehouseOverrides[ds];
                return (
                  <button key={i} onClick={() => toggleOverride(date)} disabled={profile?.role !== 'admin'}
                    className={`p-3 rounded-lg text-center transition-all ${isFJ ? 'bg-blue-50 border border-blue-200' : 'bg-amber-50 border border-amber-200'} ${isOverridden ? 'ring-2 ring-purple-400' : ''} ${profile?.role === 'admin' ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}>
                    <span className="block text-sm font-mono text-cream-800">{i + 1}</span>
                    <span className={`block text-[10px] font-body mt-1 ${isFJ ? 'text-blue-600' : 'text-amber-700'}`}>{wh.name}</span>
                    {isOverridden && <span className="block text-[8px] text-purple-500 mt-0.5">変更</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-6 mt-5 pt-4 border-t border-cream-100">
              <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-amber-50 border border-amber-200" /><span className="text-xs font-body text-cream-600">塚本郵便逓送（平日）</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-4 rounded bg-blue-50 border border-blue-200" /><span className="text-xs font-body text-cream-600">FJロジ（土日祝）</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-4 rounded ring-2 ring-purple-400" /><span className="text-xs font-body text-cream-600">手動変更</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ======================== Session History ========================
  const renderHistory = () => (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading font-bold text-xl text-cream-900">セッション履歴</h2>
          <button onClick={loadHistory} className="flex items-center gap-2 text-sm text-cream-500 hover:text-cream-700 font-body transition-colors"><RefreshCw size={14} /> 更新</button>
        </div>
        {sessionHistory.length === 0 ? (
          <div className="bg-white rounded-xl border border-cream-200 p-12 text-center shadow-sm">
            <History size={40} className="mx-auto text-cream-300 mb-3" /><p className="font-body text-cream-500">履歴がありません</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-cream-200 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-cream-50">
                <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">日付</th>
                <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">便</th>
                <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">倉庫</th>
                <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">担当者</th>
                <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">受注数</th>
                <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">新規/既存</th>
                <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">ステータス</th>
              </tr></thead>
              <tbody>
                {sessionHistory.map((log) => (
                  <tr key={log.id} className="border-t border-cream-100 hover:bg-cream-50/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono text-cream-800">{log.date}</td>
                    <td className="px-4 py-3 text-sm font-body text-cream-600">{log.type === 'daytime' ? '昼の部' : '夕の部'}</td>
                    <td className="px-4 py-3 text-sm font-body text-cream-600">{log.warehouse?.name}</td>
                    <td className="px-4 py-3 text-sm font-body text-cream-800">{log.staffName}</td>
                    <td className="px-4 py-3 text-sm font-mono text-cream-600">{log.orderCount}</td>
                    <td className="px-4 py-3 text-sm font-mono text-cream-600">{log.newOrderCount ?? '-'}/{log.existingOrderCount ?? '-'}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-body ${log.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{log.status === 'completed' ? '完了' : '進行中'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // ======================== Settings ========================
  const renderSettings = () => <SettingsPage
    holidays={holidays} setHolidaysState={setHolidaysState}
    opluxKeywords={opluxKeywords} setOpluxKeywordsState={setOpluxKeywordsState}
    irregularCodes={irregularCodes} setIrregularCodesState={setIrregularCodesState}
    apiConfig={apiConfig} setApiConfigState={setApiConfigState}
    setIsDemo={setIsDemo} showToast={showToast}
    ecforceApi={ecforceApi} setEcforceApi={setEcforceApi}
    setAddressService={setAddressService}
    holdMailTemplates={holdMailTemplates} setHoldMailTemplatesState={setHoldMailTemplatesState}
  />;

  // ======================== Session Modal ========================
  const renderSessionModal = () => {
    if (!showSessionModal) return null;
    // モーダル内でリアルタイム更新: sessionType に応じた発送日・倉庫を計算
    const modalWarehouse = getWarehouse(selectedDate, holidays, warehouseOverrides, sessionType);
    const modalShippingDate = modalWarehouse.shippingDate;

    return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-heading font-bold text-lg text-cream-900">新規セッション開始</h3>
          <button onClick={() => setShowSessionModal(false)} className="p-1 rounded-lg hover:bg-cream-100 text-cream-400"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-body text-cream-600 mb-1.5">セッション日</label>
            <p className="text-sm font-mono text-cream-800 bg-cream-50 rounded-lg px-3 py-2.5">{formatDate(selectedDate)}</p>
          </div>
          <div>
            <label className="block text-xs font-body text-cream-600 mb-1.5">便</label>
            <div className="flex gap-2">
              {[{ value: 'daytime', label: '昼の部 (12:30締切)' }, { value: 'evening', label: '夕の部 (16:00締切)' }].map((opt) => (
                <button key={opt.value} onClick={() => setSessionType(opt.value)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-body transition-colors ${sessionType === opt.value ? 'bg-accent text-white' : 'bg-cream-100 text-cream-600 hover:bg-cream-200'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {/* 便選択に応じてリアルタイム更新 */}
          <div className={`rounded-lg px-3 py-2.5 text-sm font-body border ${modalWarehouse.id === 'fj_logi' ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{modalWarehouse.name}</span>
              <span className="text-xs opacity-70">{modalWarehouse.systemName}</span>
            </div>
            <div className="text-xs mt-0.5 opacity-80">
              発送日: {modalShippingDate}
              {sessionType === 'evening' && <span className="ml-1 text-[10px] font-heading bg-white/60 px-1.5 py-0.5 rounded-full">翌日発送</span>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-body text-cream-600 mb-1.5">担当者名</label>
            <input type="text" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="田中太郎"
              className="w-full px-3 py-2.5 rounded-lg border border-cream-300 text-sm font-body text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent" />
          </div>
        </div>
        <button onClick={startSession} disabled={loading}
          className="mt-6 w-full bg-accent hover:bg-accent-dark text-white font-heading font-semibold py-3 rounded-lg transition-colors disabled:opacity-50">
          {loading
            ? loadingProgress
              ? `受注取得中... ${loadingProgress.fetched}${loadingProgress.total ? ` / ${loadingProgress.total}件` : '件'}`
              : '読み込み中...'
            : 'セッション開始'}
        </button>
        {loading && loadingProgress && loadingProgress.total > 0 && (
          <div className="mt-2 w-full bg-cream-200 rounded-full h-2">
            <div className="bg-accent h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (loadingProgress.fetched / loadingProgress.total) * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
    );
  };

  // ======================== Render ========================
  const isStaging = import.meta.env.MODE === 'staging';
  return (
    <div className="flex flex-col h-screen">
      {isStaging && (
        <div className="shrink-0 bg-orange-500 text-white flex items-center justify-center gap-2 py-2 text-sm font-heading font-bold tracking-widest">
          <span>⚠</span><span>ステージング環境</span><span>⚠</span>
        </div>
      )}
    <div className="flex flex-1 bg-cream-100 font-body overflow-hidden">
      {renderSidebar()}
      {currentPage === 'dashboard' && renderDashboard()}
      {currentPage === 'taskDetail' && renderTaskDetail()}
      {currentPage === 'warehouse' && profile?.role === 'admin' && renderWarehouseCalendar()}
      {currentPage === 'history' && renderHistory()}
      {currentPage === 'settings' && renderSettings()}
      {currentPage === 'users' && <div className="flex-1 p-6 overflow-auto"><AdminPanel /></div>}
      {renderSessionModal()}
      {loading && <LoadingSpinner message={loading === true ? '処理中...' : loading} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* 出荷ステータス変更完了 → 出荷リスト登録案内ポップアップ */}
      {shipRegisterModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-md p-7 shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-3 bg-green-100 rounded-xl text-green-600"><CheckCircle2 size={24} /></div>
              <div>
                <h3 className="font-heading font-bold text-lg text-cream-900">出荷ステータス変更 完了</h3>
                <p className="text-xs font-body text-cream-500 mt-0.5">続けて出荷リスト登録を行ってください</p>
              </div>
            </div>

            {/* 手順説明 */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
              <p className="text-sm font-heading font-semibold text-blue-800 mb-2">出荷リスト登録をしてください</p>
              <div className="flex items-center gap-2 text-sm font-body text-blue-700 flex-wrap">
                <span className="px-2.5 py-1 bg-blue-100 rounded-lg font-semibold">一括更新</span>
                <span className="text-blue-400">→</span>
                <span className="px-2.5 py-1 bg-blue-100 rounded-lg font-semibold">出荷リスト：出力済</span>
                <span className="text-blue-400">→</span>
                <span className="px-2.5 py-1 bg-blue-100 rounded-lg font-semibold">保存</span>
              </div>
            </div>

            {/* 遷移ボタン */}
            {!shipRegisterModal.navigated ? (
              <a
                href={shipRegisterModal.shipListUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShipRegisterModal((prev) => prev ? { ...prev, navigated: true } : prev)}
                className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-dark text-white text-sm rounded-xl font-heading font-bold transition-colors shadow-md">
                <ExternalLink size={16} /> 出荷リスト画面を開く
              </a>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-body text-green-600 bg-green-50 rounded-lg px-3 py-2">
                  <CheckCircle2 size={16} /> 画面を開きました。手順に従って保存してください。
                </div>
                <button
                  onClick={() => completeShipRegister(shipRegisterModal.groupKey)}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-700 text-white text-sm rounded-xl font-heading font-bold transition-colors shadow-md">
                  <CheckCircle2 size={16} /> 完了
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 差分チェック中モーダル（操作ブロック） */}
      {recheckLoading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl px-10 py-8 shadow-2xl flex flex-col items-center gap-4 max-w-sm w-full mx-4">
            <div className="w-12 h-12 border-4 border-cream-200 border-t-accent rounded-full animate-spin" />
            <div className="text-center">
              <p className="font-heading font-bold text-cream-900 text-base">ステータス確認中</p>
              <p className="text-sm font-body text-cream-500 mt-1">セッション開始時と受注ステータスを比較中...</p>
            </div>
          </div>
        </div>
      )}

      {/* 保留処理ダイアログ */}
      {holdDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-amber-100 rounded-lg text-amber-600"><Pause size={20} /></div>
              <h3 className="font-heading font-bold text-base text-cream-900">保留処理</h3>
            </div>
            <p className="text-sm font-body text-cream-600 mb-3">
              受注ID: <span className="font-mono text-accent">{holdDialog.order.id}</span>
            </p>
            <div className="bg-amber-50 rounded-lg px-4 py-3 mb-4 space-y-2">
              <p className="text-xs font-heading font-semibold text-amber-700 mb-2">実行する操作を選択：</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={holdDialog.doHold}
                  onChange={() => setHoldDialog(prev => ({ ...prev, doHold: !prev.doHold }))}
                  className="w-4 h-4 accent-amber-600 rounded" />
                <span className="text-xs font-body text-amber-700">受注保留にする</span>
              </label>
              {holdDialog.order.subs_order_id && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={holdDialog.doSuspendSubs}
                    onChange={() => setHoldDialog(prev => ({ ...prev, doSuspendSubs: !prev.doSuspendSubs }))}
                    className="w-4 h-4 accent-amber-600 rounded" />
                  <span className="text-xs font-body text-amber-700">定期受注を解約する</span>
                </label>
              )}
            </div>
            <div className="mb-5">
              <label className="block text-xs font-heading font-semibold text-cream-600 mb-1.5">メール・SMS送信</label>
              <select
                value={holdDialog.mailTemplateId}
                onChange={(e) => setHoldDialog(prev => ({ ...prev, mailTemplateId: e.target.value }))}
                className="w-full text-sm border border-cream-200 rounded-lg px-3 py-2 font-body text-cream-700 bg-white focus:outline-none focus:ring-1 focus:ring-accent/30">
                <option value="">送信しない</option>
                {holdMailTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setHoldDialog(null)}
                className="flex-1 py-2.5 bg-cream-100 hover:bg-cream-200 text-cream-700 text-sm rounded-lg font-body transition-colors">
                戻る
              </button>
              <button
                onClick={() => handleHoldOrder(holdDialog)}
                disabled={!holdDialog.doHold && !holdDialog.doSuspendSubs && !holdDialog.mailTemplateId}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg font-heading font-semibold transition-colors">
                実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* キャンセル確認ダイアログ */}
      {cancelConfirmDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-red-100 rounded-lg text-red-600"><Ban size={20} /></div>
              <h3 className="font-heading font-bold text-base text-cream-900">テスト受注をキャンセルしますか？</h3>
            </div>
            <p className="text-sm font-body text-cream-600 mb-3">
              受注ID: <span className="font-mono text-accent">{cancelConfirmDialog.order.id}</span>
            </p>
            <div className="bg-red-50 rounded-lg px-4 py-3 mb-5 space-y-2">
              <p className="text-xs font-heading font-semibold text-red-700 mb-2">実行する操作を選択：</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cancelConfirmDialog.doOrder}
                  onChange={() => setCancelConfirmDialog(prev => ({ ...prev, doOrder: !prev.doOrder }))}
                  className="w-4 h-4 accent-red-600 rounded" />
                <span className="text-xs font-body text-red-700">対応状況 → キャンセル</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cancelConfirmDialog.doPayment}
                  onChange={() => setCancelConfirmDialog(prev => ({ ...prev, doPayment: !prev.doPayment }))}
                  className="w-4 h-4 accent-red-600 rounded" />
                <span className="text-xs font-body text-red-700">決済 → キャンセル（取消処理）</span>
              </label>
              {cancelConfirmDialog.order.subs_order_id && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={cancelConfirmDialog.doSubs}
                    onChange={() => setCancelConfirmDialog(prev => ({ ...prev, doSubs: !prev.doSubs }))}
                    className="w-4 h-4 accent-red-600 rounded" />
                  <span className="text-xs font-body text-red-700">定期 → 解約</span>
                </label>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCancelConfirmDialog(null)}
                className="flex-1 py-2.5 bg-cream-100 hover:bg-cream-200 text-cream-700 text-sm rounded-lg font-body transition-colors">
                戻る
              </button>
              <button onClick={() => handleCancelOrder(cancelConfirmDialog)}
                disabled={!cancelConfirmDialog.doOrder && !cancelConfirmDialog.doPayment && !cancelConfirmDialog.doSubs}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg font-heading font-semibold transition-colors">
                キャンセル実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 氏名編集ダイアログ */}
      {nameEditDialog && (
        <NameEditDialog
          order={nameEditDialog.order}
          onClose={() => setNameEditDialog(null)}
          onSave={(nameData) => handleUpdateName(nameEditDialog.order, nameData)}
        />
      )}
    </div>
    </div>
  );
}

// ======================== Stat Card ========================
function StatCard({ label, value, sub, color = 'text-cream-900' }) {
  return (
    <div className="bg-white rounded-xl border border-cream-200 p-4 shadow-sm">
      <p className="text-xs font-body text-cream-500 mb-1">{label}</p>
      <p className={`text-2xl font-heading font-bold ${color}`}>{value}{sub && <span className="text-sm text-cream-400">{sub}</span>}</p>
    </div>
  );
}

// ======================== Settings Page ========================
function SettingsPage({ holidays, setHolidaysState, opluxKeywords, setOpluxKeywordsState, irregularCodes, setIrregularCodesState, apiConfig, setApiConfigState, setIsDemo, showToast, ecforceApi, setEcforceApi, setAddressService, holdMailTemplates, setHoldMailTemplatesState }) {
  const [activeTab, setActiveTab] = useState('holidays');
  const [newHoliday, setNewHoliday] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newCode, setNewCode] = useState('');
  const [ecforceBaseUrl, setEcforceBaseUrl] = useState(apiConfig?.ecforceBaseUrl || '');
  const [ecforceToken, setEcforceToken] = useState(apiConfig?.ecforceToken || '');
  const [openaiKey, setOpenaiKey] = useState(apiConfig?.openaiKey || '');
  const [openaiPromptId, setOpenaiPromptId] = useState(apiConfig?.openaiPromptId || 'pmpt_68c23271a2648190a7271a024b25f451065e59a2da9efda4');
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [newIrregWarehouse, setNewIrregWarehouse] = useState('fj_logi');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [newTplLabel, setNewTplLabel] = useState('');
  const [newTplId, setNewTplId] = useState('');

  const tabs = [
    { id: 'holidays', label: '祝日管理' },
    { id: 'oplux', label: 'O-PLUXキーワード' },
    { id: 'irregular', label: 'イレギュラー商品' },
    { id: 'holdTemplates', label: '保留メールテンプレート' },
    { id: 'api', label: 'API設定' },
  ];

  const saveHoliday = async () => {
    if (!newHoliday) return;
    setSettingsLoading(true);
    const u = [...holidays, newHoliday].sort();
    await setHolidays(u);
    setHolidaysState(u);
    setNewHoliday('');
    showToast('祝日を追加しました', 'success');
    setSettingsLoading(false);
  };
  const removeHoliday = async (d) => {
    setSettingsLoading(true);
    const u = holidays.filter((x) => x !== d);
    await setHolidays(u);
    setHolidaysState(u);
    setSettingsLoading(false);
  };
  const saveKeyword = async () => {
    if (!newKeyword.trim()) return;
    setSettingsLoading(true);
    const u = [...opluxKeywords, newKeyword.trim()];
    await setOpluxKeywords(u);
    setOpluxKeywordsState(u);
    setNewKeyword('');
    showToast('キーワードを追加しました', 'success');
    setSettingsLoading(false);
  };
  const removeKeyword = async (kw) => {
    setSettingsLoading(true);
    const u = opluxKeywords.filter((k) => k !== kw);
    await setOpluxKeywords(u);
    setOpluxKeywordsState(u);
    setSettingsLoading(false);
  };
  const saveCode = async () => {
    if (!newCode.trim()) return;
    setSettingsLoading(true);
    const entry = { code: newCode.trim(), warehouseId: newIrregWarehouse, warehouseLabel: newIrregWarehouse === 'fj_logi' ? 'FJロジ' : '塚本郵便逓送' };
    const u = [...irregularCodes, entry];
    await setIrregularCodes(u);
    setIrregularCodesState(u);
    setNewCode('');
    showToast('商品コードを追加しました', 'success');
    setSettingsLoading(false);
  };
  const removeCode = async (code) => {
    setSettingsLoading(true);
    const u = irregularCodes.filter((x) => (typeof x === 'object' ? x.code : x) !== code);
    await setIrregularCodes(u);
    setIrregularCodesState(u);
    setSettingsLoading(false);
  };

  const saveHoldTemplate = async () => {
    if (!newTplLabel.trim() || !newTplId.trim()) return;
    setSettingsLoading(true);
    const updated = [...(holdMailTemplates || []), { id: newTplId.trim(), label: newTplLabel.trim() }];
    await setHoldMailTemplates(updated);
    setHoldMailTemplatesState(updated);
    setNewTplLabel('');
    setNewTplId('');
    showToast('テンプレートを追加しました', 'success');
    setSettingsLoading(false);
  };
  const removeHoldTemplate = async (id) => {
    setSettingsLoading(true);
    const updated = (holdMailTemplates || []).filter((t) => t.id !== id);
    await setHoldMailTemplates(updated);
    setHoldMailTemplatesState(updated);
    setSettingsLoading(false);
  };

  const addDefaultHolidays = async () => {
    setSettingsLoading(true);
    const merged = [...new Set([...holidays, ...JAPAN_DEFAULT_HOLIDAYS])].sort();
    await setHolidays(merged);
    setHolidaysState(merged);
    showToast(`${JAPAN_DEFAULT_HOLIDAYS.length}件のデフォルト祝日を追加しました`, 'success');
    setSettingsLoading(false);
  };

  const saveApiSettings = async () => {
    setSaving(true);
    const config = { ecforceBaseUrl, ecforceToken, openaiKey, openaiPromptId };
    await setApiConfig(config);
    setApiConfigState(config);
    const demo = !(ecforceBaseUrl && ecforceToken);
    setIsDemo(demo);
    setEcforceApi(new EcforceAPI({ isDemo: demo, apiConfig: config }));
    setAddressService(new AddressCorrectionService({ isDemo: demo, apiConfig: config }));
    showToast(`API設定を保存しました (${demo ? 'DEMO' : 'LIVE'}モード)`, demo ? 'info' : 'success');
    setSaving(false);
  };

  const testApiConnection = async () => {
    setTestResult(null);
    try {
      const testApi = new EcforceAPI({ isDemo: false, apiConfig: { ecforceBaseUrl, ecforceToken } });
      await testApi.proxyRequest('GET', '/api/v2/admin/orders', null, { per: 1 });
      setTestResult({ success: true, message: '接続成功' });
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      {settingsLoading && (
        <div className="fixed inset-0 bg-white/60 flex items-center justify-center z-[200]">
          <div className="bg-white rounded-xl shadow-lg p-6 flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-cream-200 border-t-accent rounded-full animate-spin" />
            <span className="text-sm text-cream-700">保存中...</span>
          </div>
        </div>
      )}
      <div className="max-w-3xl mx-auto">
        <h2 className="font-heading font-bold text-xl text-cream-900 mb-5">設定</h2>
        <div className="flex gap-1 bg-cream-200 rounded-lg p-1 mb-6">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2 text-sm rounded-md font-body transition-colors ${activeTab === tab.id ? 'bg-white text-cream-900 shadow-sm font-bold' : 'text-cream-500 hover:text-cream-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-cream-200 p-5 shadow-sm">
          {activeTab === 'holidays' && (
            <div>
              <div className="flex gap-2 mb-3">
                <button onClick={addDefaultHolidays} disabled={settingsLoading}
                  className="px-3 py-2 bg-blue-50 text-blue-700 text-sm rounded-lg font-body hover:bg-blue-100 transition-colors border border-blue-200 disabled:opacity-50 whitespace-nowrap">
                  🗓 デフォルト祝日を追加
                </button>
              </div>
              <div className="flex gap-2 mb-4">
                <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-cream-300 text-sm font-mono text-cream-800 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                <button onClick={saveHoliday} className="px-4 py-2 bg-accent text-white text-sm rounded-lg font-heading font-semibold hover:bg-accent-dark transition-colors">追加</button>
              </div>
              {holidays.length === 0 ? <p className="text-sm text-cream-400 font-body text-center py-6">祝日が登録されていません</p> : (
                <div className="space-y-2">{holidays.map((d) => (
                  <div key={d} className="flex items-center justify-between px-3 py-2 bg-cream-50 rounded-lg">
                    <span className="text-sm font-mono text-cream-800">{d}</span>
                    <button onClick={() => removeHoliday(d)} className="text-cream-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                  </div>
                ))}</div>
              )}
            </div>
          )}
          {activeTab === 'oplux' && (
            <div>
              <div className="flex gap-2 mb-4">
                <input type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="キーワードを入力" className="flex-1 px-3 py-2 rounded-lg border border-cream-300 text-sm font-body text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                <button onClick={saveKeyword} className="px-4 py-2 bg-accent text-white text-sm rounded-lg font-heading font-semibold hover:bg-accent-dark transition-colors">追加</button>
              </div>
              {opluxKeywords.length === 0 ? <p className="text-sm text-cream-400 font-body text-center py-6">キーワードが登録されていません</p> : (
                <div className="space-y-2">
                  {opluxKeywords.map((kw) => (
                    <div key={kw} className="flex items-center justify-between px-3 py-2.5 bg-cream-50 rounded-lg border border-cream-100">
                      <span className="text-sm font-body text-cream-800 font-semibold">{kw}</span>
                      <button onClick={() => removeKeyword(kw)} disabled={settingsLoading}
                        className="text-cream-400 hover:text-red-500 transition-colors disabled:opacity-50"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === 'irregular' && (
            <div>
              <p className="text-xs text-cream-500 mb-4 font-body">商品コード単位で出荷倉庫を固定します。対象SKUを含む受注はメイン受注から除外され、指定倉庫扱いとなります。</p>
              <div className="flex gap-2 mb-4">
                <input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)}
                  placeholder="商品コード (例: LW-0001)"
                  className="flex-1 px-3 py-2 rounded-lg border border-cream-300 text-sm font-body text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                <select value={newIrregWarehouse} onChange={(e) => setNewIrregWarehouse(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-cream-300 text-sm font-body text-cream-800 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30">
                  <option value="fj_logi">FJロジ</option>
                  <option value="tsukamoto">塚本郵便逓送</option>
                </select>
                <button onClick={saveCode} disabled={settingsLoading}
                  className="px-4 py-2 bg-accent text-white text-sm rounded-lg font-heading font-semibold hover:bg-accent-dark transition-colors disabled:opacity-50">
                  追加
                </button>
              </div>
              {irregularCodes.length === 0 ? <p className="text-sm text-cream-400 font-body text-center py-6">商品コードが登録されていません</p> : (
                <div className="space-y-2">
                  {irregularCodes.map((item) => {
                    const code = typeof item === 'object' ? item.code : item;
                    const wLabel = typeof item === 'object' ? (item.warehouseLabel || item.warehouseId) : '—';
                    return (
                      <div key={code} className="flex items-center justify-between px-3 py-2.5 bg-cream-50 rounded-lg border border-cream-100">
                        <div>
                          <span className="text-sm font-mono text-cream-800 font-semibold">{code}</span>
                          <span className="ml-3 text-xs text-cream-500 bg-cream-200 px-2 py-0.5 rounded-full">{wLabel}</span>
                        </div>
                        <button onClick={() => removeCode(code)} disabled={settingsLoading}
                          className="text-cream-400 hover:text-red-500 transition-colors disabled:opacity-50"><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {activeTab === 'holdTemplates' && (
            <div className="space-y-4">
              <p className="text-xs font-body text-cream-500">
                保留処理時の「メール・SMS送信」選択肢を管理します。テンプレートIDはecforce管理画面で確認してください。
              </p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs font-heading font-semibold text-cream-600 block mb-1">テンプレート名</label>
                  <input type="text" value={newTplLabel} onChange={(e) => setNewTplLabel(e.target.value)}
                    placeholder="例: 決済エラーのお知らせ"
                    className="w-full px-3 py-2 text-sm border border-cream-200 rounded-lg font-body focus:outline-none focus:ring-1 focus:ring-accent/30" />
                </div>
                <div className="w-28">
                  <label className="text-xs font-heading font-semibold text-cream-600 block mb-1">テンプレートID</label>
                  <input type="number" value={newTplId} onChange={(e) => setNewTplId(e.target.value)}
                    placeholder="例: 12"
                    className="w-full px-3 py-2 text-sm border border-cream-200 rounded-lg font-body focus:outline-none focus:ring-1 focus:ring-accent/30" />
                </div>
                <button onClick={saveHoldTemplate}
                  disabled={!newTplLabel.trim() || !newTplId.trim() || settingsLoading}
                  className="px-4 py-2 bg-accent text-white text-sm rounded-lg font-heading font-semibold disabled:opacity-40 transition-colors">
                  追加
                </button>
              </div>
              <div className="space-y-2">
                {(holdMailTemplates || []).map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 bg-cream-50 rounded-lg border border-cream-200">
                    <div>
                      <span className="text-sm font-body text-cream-800">{t.label}</span>
                      <span className="ml-2 text-xs font-mono text-cream-500">ID: {t.id}</span>
                    </div>
                    <button onClick={() => removeHoldTemplate(t.id)}
                      className="text-cream-400 hover:text-red-500 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {(holdMailTemplates || []).length === 0 && (
                  <p className="text-xs font-body text-cream-400 text-center py-4">テンプレートが登録されていません</p>
                )}
              </div>
            </div>
          )}
          {activeTab === 'api' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-body text-cream-600 mb-1.5">ecforce API エンドポイント</label>
                <input type="text" value={ecforceBaseUrl} onChange={(e) => setEcforceBaseUrl(e.target.value)} placeholder="https://your-shop.ec-force.com"
                  className="w-full px-3 py-2.5 rounded-lg border border-cream-300 text-sm font-mono text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              <div>
                <label className="block text-xs font-body text-cream-600 mb-1.5">ecforce API トークン</label>
                <input type="password" value={ecforceToken} onChange={(e) => setEcforceToken(e.target.value)} placeholder="Bearer token"
                  className="w-full px-3 py-2.5 rounded-lg border border-cream-300 text-sm font-mono text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              <div>
                <label className="block text-xs font-body text-cream-600 mb-1.5">OpenAI API キー（住所校正用）</label>
                <input type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-..."
                  className="w-full px-3 py-2.5 rounded-lg border border-cream-300 text-sm font-mono text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              <div>
                <label className="block text-xs font-body text-cream-600 mb-1.5">OpenAI プロンプトID（住所校正用ストアドプロンプト）</label>
                <input type="text" value={openaiPromptId} onChange={(e) => setOpenaiPromptId(e.target.value)} placeholder="pmpt_..."
                  className="w-full px-3 py-2.5 rounded-lg border border-cream-300 text-sm font-mono text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/30" />
                <p className="text-xs font-body text-cream-400 mt-1">Responses API で使用するストアドプロンプトのIDです</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={saveApiSettings} disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-dark text-white text-sm rounded-lg font-heading font-semibold transition-colors disabled:opacity-50">
                  <Save size={16} /> {saving ? '保存中...' : '保存'}
                </button>
                <button onClick={testApiConnection}
                  className="flex items-center gap-2 px-4 py-2.5 bg-cream-100 hover:bg-cream-200 text-cream-700 text-sm rounded-lg font-body transition-colors">
                  <Zap size={14} /> 接続テスト
                </button>
              </div>
              {testResult && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-body ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {testResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  {testResult.message}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
