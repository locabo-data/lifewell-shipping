import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  FileSearch,
  Link,
  ListChecks,
  MapPin,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  UserRoundSearch,
  Users,
  Warehouse,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const TASKS = [
  {
    number: '01',
    title: '過去出荷分確認',
    icon: Clock3,
    target: '出荷対象日の15日前〜前日の未出荷受注',
    system: '過去分のうち、出荷可能な状態の受注を抽出します。',
    operator: '発送日を当日に変更し、今回の出荷対象へ追加します。',
  },
  {
    number: '02',
    title: '決済エラー確認',
    icon: CreditCard,
    target: '与信失敗・売上失敗などの決済エラー',
    system: 'payment_stateから決済上の問題がある受注を検出します。',
    operator: '保留・定期停止・顧客連絡など、必要な対応を行います。',
  },
  {
    number: '03',
    title: 'NP別送確認',
    icon: FileSearch,
    target: '支払方法ID 57 / 24 / 61',
    system: 'NP後払いの請求書別送対象を一覧にします。',
    operator: '案内内容と受注内容を確認し、問題なければ完了します。',
  },
  {
    number: '04',
    title: 'テスト注文・氏名不備',
    icon: UserRoundSearch,
    target: '初回注文（times ≤ 1）',
    system: 'テスト語、数字・記号だけの氏名、不自然な文字列などを検出します。',
    operator: 'テスト注文は取消し、氏名不備は正しい氏名へ修正します。',
  },
  {
    number: '05',
    title: '重複注文確認',
    icon: Users,
    target: '同一セッション内で氏名または住所が一致',
    system: '全角半角・空白・ハイフンをそろえて重複候補を探します。',
    operator: '顧客へ確認し、重複と判断した受注を取消します。',
  },
  {
    number: '06',
    title: '単品注文確認',
    icon: ShoppingBag,
    target: '設定済みの商品コードを含む受注',
    system: '対象商品を指定された倉庫のイレギュラー出荷へ分けます。',
    operator: '商品と振分先倉庫を確認して処理を進めます。',
  },
  {
    number: '07',
    title: '購入URL確認',
    icon: Link,
    target: 'times=1 かつURLにdefo / testを含む',
    system: 'テスト用・確認用URLから入った初回注文を検出します。',
    operator: '本番出荷が必要か確認し、不要であれば取消します。',
  },
  {
    number: '08',
    title: '住所校正',
    icon: MapPin,
    target: '初回注文（times ≤ 1）',
    system: '未校正の住所をAIで確認し、OK・Review・NGに分類します。',
    operator: '変更内容を目視確認してからecforceへ反映します。',
  },
  {
    number: '09',
    title: 'O-PLUX審査確認',
    icon: ShieldCheck,
    target: 'times=1、REVIEWまたは詳細ありのOK',
    system: '確認が必要な審査結果と審査理由を表示します。',
    operator: '理由を読み、出荷・保留・取消のいずれかを判断します。',
  },
];

const CATEGORIES = [
  {
    id: 'overview',
    title: 'はじめに',
    short: '業務全体の流れ',
    description: '迷ったときに最初に見るページです',
    keywords: 'はじめに 全体 流れ セッション',
    icon: BookOpen,
  },
  {
    id: 'calendar',
    title: '出荷日と倉庫',
    short: '日付・倉庫の決め方',
    description: '昼の部・夕の部と倉庫の判定',
    keywords: '出荷日 昼 夕 倉庫 FJ 塚本 祝日',
    icon: CalendarDays,
  },
  {
    id: 'orders',
    title: '対象受注',
    short: '受注の抽出と件数',
    description: 'どの受注が処理対象になるか',
    keywords: '受注 抽出 complete times 件数',
    icon: Package,
  },
  {
    id: 'tasks',
    title: '確認タスク',
    short: '9タスクの対象と対応',
    description: '検出理由と担当者が行う作業',
    keywords: TASKS.map((task) => `${task.title} ${task.target}`).join(' '),
    icon: ListChecks,
  },
  {
    id: 'address',
    title: '住所校正',
    short: 'AI判定と住所反映',
    description: '住所を直してよい条件と固定ルール',
    keywords: '住所 AI OK Review NG addr01 addr02',
    icon: MapPin,
  },
  {
    id: 'shipping',
    title: '出荷登録',
    short: '登録前の確認',
    description: '差分チェックと登録可能な条件',
    keywords: '出荷 登録 差分 state payment_state',
    icon: Truck,
  },
  {
    id: 'recovery',
    title: 'エラー対応',
    short: '失敗時の確認手順',
    description: '再試行と担当者が確認する場所',
    keywords: 'エラー 429 500 再試行 API',
    icon: RefreshCw,
  },
];

function Section({ title, description, children }) {
  return (
    <section className="bg-white rounded-xl border border-cream-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-cream-100">
        <h3 className="font-heading font-bold text-sm text-cream-900">{title}</h3>
        {description && <p className="text-xs text-cream-500 mt-1">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Conclusion({ children }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
      <CircleHelp size={19} className="text-accent shrink-0 mt-0.5" />
      <div>
        <p className="font-heading font-bold text-sm text-blue-900">まず結論</p>
        <div className="text-sm text-blue-800 leading-7 mt-1">{children}</div>
      </div>
    </div>
  );
}

function Warning({ title, children }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
      <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="font-heading font-bold text-sm text-amber-900">{title}</p>
        <div className="text-xs text-amber-800 leading-6 mt-1">{children}</div>
      </div>
    </div>
  );
}

function Formula({ label, children }) {
  return (
    <div className="rounded-lg border border-cream-200 bg-cream-50 p-4">
      <p className="text-xs font-heading font-semibold text-cream-500 mb-2">{label}</p>
      <div className="font-mono text-sm font-semibold text-cream-800 leading-7 whitespace-pre-line">{children}</div>
    </div>
  );
}

function ProcessRow({ number, title, system, operator, isLast }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold">
          {number}
        </div>
        {!isLast && <div className="w-px flex-1 bg-cream-200 my-2" />}
      </div>
      <div className={`flex-1 pb-5 ${isLast ? '' : 'border-b border-cream-100 mb-5'}`}>
        <h4 className="font-heading font-bold text-sm text-cream-900">{title}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div className="rounded-lg bg-cream-50 p-3">
            <p className="text-[10px] font-heading font-bold text-cream-400 mb-1">システム</p>
            <p className="text-xs text-cream-700 leading-5">{system}</p>
          </div>
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-[10px] font-heading font-bold text-blue-500 mb-1">担当者</p>
            <p className="text-xs text-blue-900 leading-5">{operator}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewPage({ onSelect }) {
  const steps = [
    ['1', 'セッションを開始', '選択日と昼・夕から出荷日・倉庫を計算します。', '日付、便、担当者名を確認します。'],
    ['2', '対象受注を取得', '対象日のcomplete受注をecforceから取得します。', '取得件数、新規件数、既存件数を確認します。'],
    ['3', '9つのタスクを確認', '問題や確認事項がある受注をタスク別に表示します。', '表示された受注を確認し、完了またはスキップします。'],
    ['4', '差分を再確認', '作業中にecforceで変わった受注を検出します。', '差分がある受注を確認し、出荷対象から外すか判断します。'],
    ['5', '出荷登録', '出荷可能な受注だけを倉庫別stateへ更新します。', '件数を確認して出荷登録を実行します。'],
  ];
  const quickLinks = [
    ['出荷日・倉庫が分からない', 'calendar'],
    ['受注が表示されない', 'orders'],
    ['確認タスクの対応を知りたい', 'tasks'],
    ['住所を修正してよいか迷う', 'address'],
    ['出荷登録できない', 'shipping'],
    ['エラーが出た', 'recovery'],
  ];

  return (
    <div className="space-y-4">
      <Conclusion>
        画面上から順番に処理し、9つのタスクがすべて「完了」または「スキップ」になると出荷登録へ進めます。
      </Conclusion>
      <Section title="出荷業務の流れ" description="各段階でシステムと担当者が行うこと">
        {steps.map((step, index) => (
          <ProcessRow
            key={step[0]}
            number={step[0]}
            title={step[1]}
            system={step[2]}
            operator={step[3]}
            isLast={index === steps.length - 1}
          />
        ))}
      </Section>
      <Section title="困ったときはこちら">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {quickLinks.map(([label, page]) => (
            <button
              key={page}
              onClick={() => onSelect(page)}
              className="flex items-center justify-between rounded-lg border border-cream-200 px-4 py-3 text-left text-sm text-cream-700 hover:bg-cream-50 hover:border-cream-300 transition-colors"
            >
              <span>{label}</span>
              <ChevronRight size={16} className="text-cream-400" />
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function CalendarPage({ isAdmin, onNavigate }) {
  return (
    <div className="space-y-4">
      <Conclusion>
        昼の部は選択日、夕の部は選択日の翌日が出荷対象日です。倉庫は手動指定を最優先し、指定がなければ曜日・祝日で決まります。
      </Conclusion>
      <Section title="1. 出荷対象日を決める">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Formula label="昼の部">出荷対象日 = 選択した日</Formula>
          <Formula label="夕の部">出荷対象日 = 選択した日 + 1日</Formula>
        </div>
        <p className="text-xs text-cream-500 mt-3">夕の部は、翌日の曜日・祝日を使って倉庫も判定します。</p>
      </Section>
      <Section title="2. 倉庫を決める" description="上から順に当てはまる条件を使用します">
        <div className="divide-y divide-cream-100">
          {[
            ['優先 1', '倉庫カレンダーで手動指定あり', '指定された倉庫'],
            ['優先 2', '土日または祝日', 'FJロジ / コマロボ'],
            ['優先 3', '通常の平日', '塚本郵便逓送 / COOOLa'],
          ].map(([priority, condition, result]) => (
            <div key={priority} className="grid grid-cols-[70px_1fr_1fr] gap-3 py-3 items-center text-xs">
              <span className="font-heading font-bold text-accent">{priority}</span>
              <span className="text-cream-600">{condition}</span>
              <span className="font-heading font-semibold text-cream-900">→ {result}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="判断例">
        <div className="divide-y divide-cream-100 text-sm">
          <div className="py-3 flex justify-between"><span>平日の昼の部</span><strong>当日・塚本</strong></div>
          <div className="py-3 flex justify-between"><span>金曜日の夕の部</span><strong>土曜日・FJロジ</strong></div>
          <div className="py-3 flex justify-between"><span>祝前日の夕の部</span><strong>祝日・FJロジ</strong></div>
        </div>
      </Section>
      {isAdmin && (
        <button onClick={() => onNavigate('warehouse')} className="w-full bg-white border border-cream-300 hover:bg-cream-50 rounded-lg px-4 py-3 flex items-center justify-center gap-2 text-sm font-heading font-semibold text-cream-700 transition-colors">
          <Warehouse size={17} /> 倉庫カレンダーを開く
        </button>
      )}
    </div>
  );
}

function OrdersPage({ isAdmin, onNavigate }) {
  return (
    <div className="space-y-4">
      <Conclusion>
        対象日の受注状態がcompleteの受注を取得し、要対応受注とイレギュラー商品を除いたものが通常の確認対象です。
      </Conclusion>
      <Section title="受注が画面に表示されるまで">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          {[
            ['1', '対象日のcompleteを取得'],
            ['2', '要対応を除外'],
            ['3', '対象SKUを倉庫別へ分離'],
            ['4', 'times ≤ 1を新規に分類'],
            ['5', '通常受注を9タスクへ'],
          ].map(([number, text], index) => (
            <div key={number} className="relative rounded-lg bg-cream-50 border border-cream-200 p-3">
              <span className="text-xs font-bold text-accent">{number}</span>
              <p className="text-xs text-cream-700 leading-5 mt-2">{text}</p>
              {index < 4 && <ChevronRight size={15} className="hidden md:block absolute -right-3 top-1/2 text-cream-400 z-10" />}
            </div>
          ))}
        </div>
      </Section>
      <Section title="画面に表示する件数">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Formula label="通常受注数">API取得数 - 要対応 - イレギュラー</Formula>
          <Formula label="新規件数">通常受注のうち times ≤ 1</Formula>
          <Formula label="既存件数">通常受注数 - 新規件数</Formula>
        </div>
      </Section>
      <Warning title="受注が表示されないとき">
        まず発送予定日、state、要対応フラグ、商品コードを確認してください。timesが取得できない受注は0として扱われ、初回受注へ分類されます。
      </Warning>
      {isAdmin && (
        <button onClick={() => onNavigate('settings')} className="w-full bg-white border border-cream-300 hover:bg-cream-50 rounded-lg px-4 py-3 flex items-center justify-center gap-2 text-sm font-heading font-semibold text-cream-700 transition-colors">
          <ShoppingBag size={17} /> イレギュラー商品設定を開く
        </button>
      )}
    </div>
  );
}

function TasksPage() {
  return (
    <div className="space-y-4">
      <Conclusion>
        各タスクは独立して判定されます。同じ受注が複数のタスクに表示されても異常ではありません。
      </Conclusion>
      <div className="space-y-3">
        {TASKS.map((task) => {
          const Icon = task.icon;
          return (
            <article key={task.number} className="bg-white rounded-xl border border-cream-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-3 border-b border-cream-100">
                <div className="w-9 h-9 rounded-lg bg-cream-100 text-cream-600 flex items-center justify-center">
                  <Icon size={18} />
                </div>
                <span className="text-xs font-mono text-cream-400">{task.number}</span>
                <h3 className="font-heading font-bold text-sm text-cream-900">{task.title}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-cream-100">
                <div className="p-4">
                  <p className="text-[10px] font-heading font-bold text-cream-400 mb-2">対象になる受注</p>
                  <p className="text-xs text-cream-700 leading-5">{task.target}</p>
                </div>
                <div className="p-4">
                  <p className="text-[10px] font-heading font-bold text-cream-400 mb-2">システムがすること</p>
                  <p className="text-xs text-cream-700 leading-5">{task.system}</p>
                </div>
                <div className="p-4 bg-blue-50/50">
                  <p className="text-[10px] font-heading font-bold text-blue-500 mb-2">担当者がすること</p>
                  <p className="text-xs text-blue-900 leading-5">{task.operator}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AddressPage() {
  return (
    <div className="space-y-4">
      <Conclusion>
        OKはそのまま進め、ReviewとNGは必ず目視確認します。住所を反映するときも、都道府県の値は変更しません。
      </Conclusion>
      <Section title="AI判定の見方">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg bg-green-50 border border-green-200 p-4"><strong className="text-green-700">OK</strong><p className="text-xs text-green-700 mt-2">配送上の問題なし</p></div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4"><strong className="text-amber-700">Review</strong><p className="text-xs text-amber-700 mt-2">変更内容を目視確認</p></div>
          <div className="rounded-lg bg-red-50 border border-red-200 p-4"><strong className="text-red-700">NG</strong><p className="text-xs text-red-700 mt-2">不備・配送リスクが高い</p></div>
        </div>
      </Section>
      <Section title="ecforceへ反映する住所">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Formula label="addr01（市区町村・町名）">city + town</Formula>
          <Formula label="addr02（番地・建物）">{'chome-banchi-go\n+ 半角スペース\n+ building + building_number'}</Formula>
          <Formula label="郵便番号">{'zip01 = 上3桁\nzip02 = 下4桁'}</Formula>
          <Formula label="更新対象">{'注文：配送先 + 請求先\n定期：配送先\n顧客：請求先'}</Formula>
        </div>
      </Section>
      <Warning title="この住所ルールは変更しないでください">
        <ul className="list-disc pl-4 space-y-1">
          <li>addr01へ都道府県を含めません。</li>
          <li>都道府県はecforceの現在値を維持します。</li>
          <li>prefecture_idは原則送信しません。</li>
          <li>Review・NGは反映前に校正後住所を確認します。</li>
        </ul>
      </Warning>
    </div>
  );
}

function ShippingPage() {
  return (
    <div className="space-y-4">
      <Conclusion>
        9タスク完了後に差分を確認し、現在も出荷可能な状態の受注だけを登録します。差分がある受注は自動的に出荷選択から外れます。
      </Conclusion>
      <Section title="1. 作業中の変更を確認する" description="次の値をセッション開始時と比較します">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['state', 'payment_state', 'tbc', 'human_state'].map((field) => (
            <code key={field} className="rounded-lg bg-cream-50 border border-cream-200 p-3 text-center text-xs text-cream-700">{field}</code>
          ))}
        </div>
        <p className="text-xs text-cream-500 leading-6 mt-3">state・payment_state・tbcが変わった受注や、再取得できない受注は出荷に影響する差分です。</p>
      </Section>
      <Section title="2. 出荷可能な状態を確認する">
        <Formula label="登録可能な条件">{'state = complete\nかつ\npayment_state = credit_exam_completed または authed'}</Formula>
      </Section>
      <Section title="3. 倉庫別のstateへ更新する">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cream-50">
                <th className="px-4 py-3 text-left text-xs text-cream-500">倉庫</th>
                <th className="px-4 py-3 text-left text-xs text-cream-500">連携システム</th>
                <th className="px-4 py-3 text-left text-xs text-cream-500">更新するstate</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-cream-100"><td className="px-4 py-3 font-semibold">塚本郵便逓送</td><td className="px-4 py-3">COOOLa</td><td className="px-4 py-3"><code className="bg-blue-50 text-blue-700 px-2 py-1 rounded">cooolawait</code></td></tr>
              <tr className="border-t border-cream-100"><td className="px-4 py-3 font-semibold">FJロジ</td><td className="px-4 py-3">コマロボ</td><td className="px-4 py-3"><code className="bg-green-50 text-green-700 px-2 py-1 rounded">wmswait</code></td></tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function RecoveryPage() {
  const retries = [
    ['ecforce共通API', '429を最大3回', '3秒、6秒、9秒待って再試行'],
    ['出荷登録', '失敗分を最大2回再試行', '初回を含めて最大3回'],
    ['住所書き戻し', '429・5xxを最大6回', '最低1.3秒間隔で待ち時間を延長'],
    ['住所AI校正', '3件ずつ並列処理', '失敗した住所はエラー結果として保持'],
  ];
  return (
    <div className="space-y-4">
      <Conclusion>
        一時的なAPIエラーはシステムが自動で再試行します。最終的に失敗した受注だけを確認してください。
      </Conclusion>
      <Section title="システムが自動で再試行する回数">
        <div className="divide-y divide-cream-100">
          {retries.map(([name, count, detail]) => (
            <div key={name} className="grid grid-cols-1 md:grid-cols-[160px_180px_1fr] gap-2 md:gap-4 py-4 text-xs">
              <strong className="text-cream-900">{name}</strong>
              <span className="text-accent font-semibold">{count}</span>
              <span className="text-cream-500">{detail}</span>
            </div>
          ))}
        </div>
      </Section>
      <Warning title="受注を再取得できないとき">
        発送予定日や状態が作業中に変更された可能性があります。出荷対象から外したうえで、ecforceの受注詳細を確認してください。
      </Warning>
      <Section title="担当者が確認する順番">
        <ol className="space-y-3 text-sm text-cream-700">
          <li className="flex gap-3"><span className="font-bold text-accent">1</span><span>画面に表示されたエラー対象と処理名を確認する</span></li>
          <li className="flex gap-3"><span className="font-bold text-accent">2</span><span>ecforceで対象受注の現在状態を確認する</span></li>
          <li className="flex gap-3"><span className="font-bold text-accent">3</span><span>状態を修正した場合は、該当処理だけを再実行する</span></li>
          <li className="flex gap-3"><span className="font-bold text-accent">4</span><span>同じエラーが続く場合は管理者へ連絡する</span></li>
        </ol>
      </Section>
    </div>
  );
}

export default function ShippingRules({ onNavigate = () => {} }) {
  const { profile } = useAuth();
  const [activeId, setActiveId] = useState('overview');
  const [query, setQuery] = useState('');
  const isAdmin = profile?.role === 'admin';

  const filteredCategories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return CATEGORIES;
    return CATEGORIES.filter((category) =>
      `${category.title} ${category.short} ${category.description} ${category.keywords}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  const active = CATEGORIES.find((category) => category.id === activeId) || CATEGORIES[0];
  const ActiveIcon = active.icon;

  const renderActivePage = () => {
    switch (active.id) {
      case 'calendar': return <CalendarPage isAdmin={isAdmin} onNavigate={onNavigate} />;
      case 'orders': return <OrdersPage isAdmin={isAdmin} onNavigate={onNavigate} />;
      case 'tasks': return <TasksPage />;
      case 'address': return <AddressPage />;
      case 'shipping': return <ShippingPage />;
      case 'recovery': return <RecoveryPage />;
      default: return <OverviewPage onSelect={setActiveId} />;
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen size={21} className="text-accent" />
              <h2 className="font-heading font-bold text-xl text-cream-900">出荷ルール</h2>
            </div>
            <p className="text-sm text-cream-500 mt-2">出荷作業で迷ったときに、判断条件と対応手順を確認できます。</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="キーワードで探す"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-cream-300 bg-white text-sm text-cream-800 placeholder-cream-400 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] gap-5 items-start">
          <aside className="bg-white rounded-xl border border-cream-200 shadow-sm p-2 lg:sticky lg:top-0">
            <p className="px-3 py-2 text-xs font-heading font-semibold text-cream-400">カテゴリ</p>
            <nav className="space-y-1">
              {filteredCategories.map((category) => {
                const Icon = category.icon;
                const selected = category.id === active.id;
                return (
                  <button
                    key={category.id}
                    onClick={() => setActiveId(category.id)}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      selected
                        ? 'bg-cream-200 text-cream-900 font-bold'
                        : 'text-cream-600 hover:bg-cream-100 hover:text-cream-800'
                    }`}
                  >
                    <Icon size={17} className={`shrink-0 mt-0.5 ${selected ? 'text-accent' : 'text-cream-400'}`} />
                    <span>
                      <span className="block text-sm">{category.title}</span>
                      <span className="block text-[10px] text-cream-400 mt-0.5 font-normal">{category.short}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
            {filteredCategories.length === 0 && <p className="px-3 py-8 text-center text-xs text-cream-400">該当するカテゴリがありません</p>}
          </aside>

          <main className="min-w-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-accent flex items-center justify-center">
                <ActiveIcon size={19} />
              </div>
              <div>
                <h2 className="font-heading font-bold text-lg text-cream-900">{active.title}</h2>
                <p className="text-xs text-cream-500 mt-0.5">{active.description}</p>
              </div>
            </div>
            {renderActivePage()}
          </main>
        </div>

        <div className="mt-6 flex items-center gap-2 text-xs text-cream-400">
          <CheckCircle2 size={14} />
          <span>現行のstaging実装に基づく説明です。判断に迷った場合は管理者へ確認してください。</span>
        </div>
      </div>
    </div>
  );
}

