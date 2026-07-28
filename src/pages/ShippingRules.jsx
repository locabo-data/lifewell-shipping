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
  History,
  Info,
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
    icon: History,
    tone: 'amber',
    condition: '出荷対象日の15日前〜前日',
    detail: 'state=complete、決済が仮売上または与信審査完了、未出荷、要対応フラグなしの受注。',
    action: '発送日を当日に変更し、通常出荷リストへ追加します。',
  },
  {
    number: '02',
    title: '決済エラー確認',
    icon: CreditCard,
    tone: 'red',
    condition: '決済エラー系のpayment_state',
    detail: '与信失敗・売上失敗・決済エラー・処理失敗など10種類の状態を検出します。',
    action: '保留、定期停止、要対応設定、顧客連絡を行います。',
  },
  {
    number: '03',
    title: 'NP別送確認',
    icon: FileSearch,
    tone: 'blue',
    condition: '支払方法ID 57 / 24 / 61',
    detail: 'NP後払いの請求書別送対象を一覧にします。',
    action: '必要な案内と内容確認を行い、問題なければ完了します。',
  },
  {
    number: '04',
    title: 'テスト注文・氏名不備',
    icon: UserRoundSearch,
    tone: 'violet',
    condition: '初回注文（times ≤ 1）',
    detail: 'テスト語、数字・記号のみ、欠落、不自然な文字列、O-PLUXのフリガナ不備を検出します。',
    action: 'テスト注文はキャンセルし、氏名ミスは正しい氏名へ修正します。',
  },
  {
    number: '05',
    title: '重複注文確認',
    icon: Users,
    tone: 'orange',
    condition: '同一セッション内の氏名または住所が一致',
    detail: '全角半角・空白・ハイフンを正規化して比較し、住所一致を優先します。',
    action: '顧客に確認し、重複と確定した受注をキャンセルします。',
  },
  {
    number: '06',
    title: '単品注文確認',
    icon: ShoppingBag,
    tone: 'teal',
    condition: '設定済みの商品コードを含む',
    detail: '対象SKUを含む受注を、指定された倉庫のイレギュラーグループへ振り分けます。',
    action: '商品と倉庫を確認し、指定倉庫の出荷処理へ進めます。',
  },
  {
    number: '07',
    title: '購入URL確認',
    icon: Link,
    tone: 'pink',
    condition: 'times=1 かつ URLにdefo / test',
    detail: 'テスト用・確認用URLから流入した初回受注を検出します。',
    action: '本番出荷が必要か確認し、不要ならキャンセルします。',
  },
  {
    number: '08',
    title: '住所校正',
    icon: MapPin,
    tone: 'green',
    condition: '初回注文（times ≤ 1）',
    detail: '事前校正キャッシュを優先し、未校正住所だけAIで校正します。',
    action: 'Review・NGと変更内容を目視確認してからecforceへ反映します。',
  },
  {
    number: '09',
    title: 'O-PLUX審査確認',
    icon: ShieldCheck,
    tone: 'indigo',
    condition: 'times=1、REVIEWまたは詳細ありのOK',
    detail: 'REVIEWは常に表示し、OKは審査詳細がある場合だけ表示します。NGは対象外です。',
    action: '審査詳細を読み、出荷・保留・キャンセルを判断します。',
  },
];

const TONE_CLASSES = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
  pink: 'bg-pink-50 text-pink-700 border-pink-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const CATEGORIES = [
  {
    id: 'overview',
    title: '全体の流れ',
    short: 'まずはこちら',
    description: '出荷セッション開始から出荷登録までの全体像',
    keywords: 'はじめに セッション 流れ 完了',
    icon: BookOpen,
  },
  {
    id: 'calendar',
    title: '出荷日・倉庫',
    short: '日付と倉庫判定',
    description: '昼・夕の出荷日と、平日・土日祝の倉庫計算',
    keywords: '昼 夕 翌日 平日 土日 祝日 FJ 塚本 COOOLa コマロボ',
    icon: CalendarDays,
  },
  {
    id: 'orders',
    title: '対象受注',
    short: '抽出と件数',
    description: 'ecforceから取得する条件と通常・イレギュラーの分類',
    keywords: '受注 complete tbc times 新規 既存 イレギュラー 商品コード',
    icon: Package,
  },
  {
    id: 'tasks',
    title: '9つの確認タスク',
    short: '検出条件と対応',
    description: '各タスクが何を検出し、作業者が何をするか',
    keywords: TASKS.map((task) => `${task.title} ${task.condition}`).join(' '),
    icon: ListChecks,
  },
  {
    id: 'address',
    title: '住所校正',
    short: 'AI判定と住所反映',
    description: 'OK・Review・NGとecforce住所フィールドの固定ルール',
    keywords: '住所 AI OK Review NG addr01 addr02 zip 郵便番号 都道府県',
    icon: MapPin,
  },
  {
    id: 'shipping',
    title: '出荷登録',
    short: '登録可否とstate',
    description: '差分チェック、登録条件、倉庫別のecforce更新値',
    keywords: '出荷 差分 complete authed credit_exam_completed cooolawait wmswait',
    icon: Truck,
  },
  {
    id: 'recovery',
    title: 'エラー・再試行',
    short: '失敗時の動き',
    description: 'API失敗、レート制限、再実行のルール',
    keywords: 'エラー 429 500 再試行 リトライ API 失敗',
    icon: RefreshCw,
  },
];

function Formula({ label, children, note }) {
  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50 overflow-hidden">
      <div className="px-4 py-2.5 bg-cream-100 border-b border-cream-200 flex items-center gap-2">
        <CircleHelp size={15} className="text-accent" />
        <span className="text-xs font-heading font-bold text-cream-700">{label}</span>
      </div>
      <div className="p-4">
        <div className="font-mono text-sm text-cream-900 leading-7 whitespace-pre-line">{children}</div>
        {note && <p className="text-xs text-cream-500 mt-3 leading-5">{note}</p>}
      </div>
    </div>
  );
}

function Notice({ tone = 'info', title, children }) {
  const styles = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    danger: 'bg-red-50 border-red-200 text-red-900',
    success: 'bg-green-50 border-green-200 text-green-800',
  };
  const Icon = tone === 'danger' || tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${styles[tone]}`}>
      <Icon size={18} className="shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-heading font-bold">{title}</p>
        <div className="text-xs font-body leading-6 mt-1 opacity-90">{children}</div>
      </div>
    </div>
  );
}

function RuleSection({ title, eyebrow, children }) {
  return (
    <section className="bg-white rounded-2xl border border-cream-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-cream-100">
        {eyebrow && <p className="text-[10px] uppercase tracking-widest text-accent font-heading font-bold mb-1">{eyebrow}</p>}
        <h3 className="text-base font-heading font-bold text-cream-900">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Flow({ items }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
      {items.map((item, index) => (
        <div key={item.title} className="relative">
          <div className="h-full rounded-xl border border-cream-200 bg-cream-50 p-3">
            <div className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold mb-2">
              {index + 1}
            </div>
            <p className="text-xs font-heading font-bold text-cream-900">{item.title}</p>
            <p className="text-[11px] text-cream-500 leading-5 mt-1">{item.text}</p>
          </div>
          {index < items.length - 1 && (
            <ChevronRight size={16} className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 text-cream-400 z-10" />
          )}
        </div>
      ))}
    </div>
  );
}

function OverviewPage() {
  return (
    <div className="space-y-5">
      <RuleSection eyebrow="Overview" title="出荷業務は5つの段階で進みます">
        <Flow items={[
          { title: 'セッション開始', text: '日付・昼夕・担当者を指定' },
          { title: '受注を抽出', text: '対象日と状態でecforce検索' },
          { title: '9タスク確認', text: '異常・要確認受注を処理' },
          { title: '差分チェック', text: '作業中の状態変更を再確認' },
          { title: '出荷登録', text: '倉庫別stateをecforceへ反映' },
        ]} />
      </RuleSection>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RuleSection title="セッション完了の条件">
          <Formula label="タスク完了判定">
            {'全タスク完了\n= 9タスクすべてが「完了」または「スキップ」'}
          </Formula>
        </RuleSection>
        <RuleSection title="画面上の状態">
          <div className="space-y-2 text-xs">
            {[
              ['進行中', '各確認タスクを処理している状態', 'bg-blue-100 text-blue-700'],
              ['チェック完了', '9タスク完了。差分確認と出荷登録へ', 'bg-green-100 text-green-700'],
              ['出荷完了', 'すべての倉庫グループの登録が成功', 'bg-green-600 text-white'],
            ].map(([label, text, classes]) => (
              <div key={label} className="flex items-center gap-3 p-3 rounded-lg bg-cream-50">
                <span className={`px-2 py-1 rounded-full font-heading font-bold whitespace-nowrap ${classes}`}>{label}</span>
                <span className="text-cream-600 leading-5">{text}</span>
              </div>
            ))}
          </div>
        </RuleSection>
      </div>
      <Notice tone="info" title="このページの役割">
        このルールブックは、システムがどの条件で受注を抽出・判定・更新するかを説明します。
        実際の判断に迷った場合は、各タスクの「対象条件」と「作業者の対応」を確認してください。
      </Notice>
    </div>
  );
}

function CalendarPage({ isAdmin, onNavigate }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RuleSection eyebrow="Shipping date" title="出荷対象日の計算">
          <Formula label="昼の部">
            {'出荷対象日 = カレンダーで選択した日'}
          </Formula>
          <div className="h-3" />
          <Formula label="夕の部" note="倉庫判定にも翌日の曜日・祝日を使います。">
            {'出荷対象日 = カレンダーで選択した日 + 1日'}
          </Formula>
        </RuleSection>
        <RuleSection eyebrow="Warehouse" title="倉庫の優先順位">
          <div className="space-y-3">
            {[
              ['1', '手動指定', '倉庫カレンダーの指定を最優先'],
              ['2', '土日・祝日', 'FJロジ / コマロボ'],
              ['3', '通常の平日', '塚本郵便逓送 / COOOLa'],
            ].map(([number, label, text]) => (
              <div key={number} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-cream-200 text-cream-700 flex items-center justify-center text-xs font-bold">{number}</div>
                <div>
                  <p className="text-sm font-heading font-bold text-cream-800">{label}</p>
                  <p className="text-xs text-cream-500">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </RuleSection>
      </div>
      <RuleSection title="具体例">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { date: '平日・昼の部', result: '当日 → 塚本', sub: 'COOOLaで出荷登録' },
            { date: '金曜・夕の部', result: '土曜 → FJロジ', sub: '翌日基準で判定' },
            { date: '祝前日・夕の部', result: '祝日 → FJロジ', sub: '登録祝日を参照' },
          ].map((example) => (
            <div key={example.date} className="rounded-xl border border-cream-200 p-4 bg-cream-50">
              <p className="text-xs text-cream-500">{example.date}</p>
              <p className="text-base font-heading font-bold text-cream-900 mt-1">{example.result}</p>
              <p className="text-xs text-cream-500 mt-1">{example.sub}</p>
            </div>
          ))}
        </div>
      </RuleSection>
      {isAdmin && (
        <button onClick={() => onNavigate('warehouse')}
          className="w-full rounded-xl border border-accent/30 bg-accent/5 hover:bg-accent/10 px-4 py-3 flex items-center justify-center gap-2 text-sm font-heading font-bold text-accent transition-colors">
          <Warehouse size={17} /> 倉庫カレンダーを確認・変更
        </button>
      )}
    </div>
  );
}

function OrdersPage({ isAdmin, onNavigate }) {
  return (
    <div className="space-y-5">
      <RuleSection eyebrow="Fetch" title="ecforceから取得する条件">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            ['受注状態', 'state = complete'],
            ['発送予定日', '対象日の00:00〜23:59'],
            ['取得単位', '100件ずつ全ページ'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-cream-50 border border-cream-200 p-4">
              <p className="text-xs text-cream-500">{label}</p>
              <code className="block text-sm font-mono font-bold text-cream-900 mt-2">{value}</code>
            </div>
          ))}
        </div>
      </RuleSection>
      <RuleSection eyebrow="Filter" title="取得後の分類">
        <Flow items={[
          { title: '全受注', text: '対象日のcompleteを取得' },
          { title: '初回判定', text: 'times ≤ 1 を新規扱い' },
          { title: '要対応除外', text: 'tbc=trueを通常フローから除外' },
          { title: 'SKU判定', text: '設定コードを指定倉庫へ分離' },
          { title: '通常受注', text: '9つの確認タスクへ' },
        ]} />
      </RuleSection>
      <RuleSection title="件数の計算">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Formula label="通常受注数">{'API取得数 - 要対応受注 - イレギュラー受注'}</Formula>
          <Formula label="新規件数">{'通常受注のうち times ≤ 1'}</Formula>
          <Formula label="既存件数">{'通常受注数 - 新規件数'}</Formula>
        </div>
      </RuleSection>
      <Notice tone="warning" title="timesが取得できない場合">
        現行ロジックではtimesがない受注は0として扱われるため、初回受注に分類されます。
      </Notice>
      {isAdmin && (
        <button onClick={() => onNavigate('settings')}
          className="w-full rounded-xl border border-accent/30 bg-accent/5 hover:bg-accent/10 px-4 py-3 flex items-center justify-center gap-2 text-sm font-heading font-bold text-accent transition-colors">
          <ShoppingBag size={17} /> イレギュラー商品設定を確認
        </button>
      )}
    </div>
  );
}

function TasksPage() {
  return (
    <div className="space-y-5">
      <Notice tone="info" title="タスクは通常受注に対して計算されます">
        要対応受注と倉庫別イレギュラー受注を除いたあと、各タスクの条件を独立して判定します。
        同じ受注が複数のタスクに表示されることがあります。
      </Notice>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {TASKS.map((task) => {
          const Icon = task.icon;
          return (
            <article key={task.number} className="bg-white rounded-2xl border border-cream-200 shadow-sm overflow-hidden">
              <div className="p-4 flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${TONE_CLASSES[task.tone]}`}>
                  <Icon size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-cream-400">{task.number}</span>
                    <h3 className="text-sm font-heading font-bold text-cream-900">{task.title}</h3>
                  </div>
                  <div className="inline-flex mt-2 px-2 py-1 rounded-md bg-cream-100 text-[11px] font-mono text-cream-700">
                    {task.condition}
                  </div>
                  <p className="text-xs text-cream-600 leading-5 mt-3">{task.detail}</p>
                </div>
              </div>
              <div className="px-4 py-3 bg-cream-50 border-t border-cream-100 flex items-start gap-2">
                <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" />
                <p className="text-xs text-cream-600 leading-5"><span className="font-bold text-cream-800">対応：</span>{task.action}</p>
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
    <div className="space-y-5">
      <RuleSection eyebrow="AI correction" title="住所校正の判定">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            ['OK', '配送上問題なし', 'bg-green-50 border-green-200 text-green-700'],
            ['Review', '目視確認が必要', 'bg-amber-50 border-amber-200 text-amber-700'],
            ['NG', '不備・配送リスクが高い', 'bg-red-50 border-red-200 text-red-700'],
          ].map(([score, text, classes]) => (
            <div key={score} className={`rounded-xl border p-4 ${classes}`}>
              <p className="text-lg font-heading font-bold">{score}</p>
              <p className="text-xs mt-1">{text}</p>
            </div>
          ))}
        </div>
      </RuleSection>
      <RuleSection eyebrow="Fixed mapping" title="ecforceへ送る住所の組み立て">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Formula label="addr01（市区町村・町名）">{'addr01 = city + town'}</Formula>
          <Formula label="addr02（番地・建物）">{'addr02 = chome-banchi-go\n        + 半角スペース\n        + building + building_number'}</Formula>
          <Formula label="郵便番号">{'zip01 = 上3桁\nzip02 = 下4桁'}</Formula>
          <Formula label="更新対象">{'注文：配送先 + 請求先\n定期：配送先\n顧客：請求先'}</Formula>
        </div>
      </RuleSection>
      <Notice tone="danger" title="変更禁止の住所ルール">
        <ul className="list-disc pl-4 space-y-1">
          <li>addr01に都道府県を含めません。</li>
          <li>都道府県はecforceの現在値を維持し、更新しません。</li>
          <li>prefecture_idは原則として送信しません。</li>
          <li>Review・NGは反映前に必ず校正後住所を目視確認します。</li>
        </ul>
      </Notice>
    </div>
  );
}

function ShippingPage() {
  return (
    <div className="space-y-5">
      <RuleSection eyebrow="Recheck" title="タスク完了後の差分チェック">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['state', 'payment_state', 'tbc', 'human_state'].map((field) => (
            <div key={field} className="rounded-xl border border-cream-200 bg-cream-50 p-4 text-center">
              <code className="text-xs font-mono font-bold text-cream-800">{field}</code>
            </div>
          ))}
        </div>
        <p className="text-xs text-cream-500 leading-6 mt-4">
          state・payment_state・tbcに変更がある受注、またはAPIから取得できなくなった受注は、
          出荷に影響する変更として出荷選択から自動除外されます。
        </p>
      </RuleSection>
      <RuleSection eyebrow="Eligibility" title="出荷登録できる条件">
        <Formula label="登録可否">
          {'state = complete\nかつ\npayment_state = credit_exam_completed または authed'}
        </Formula>
      </RuleSection>
      <RuleSection title="倉庫別のecforce更新値">
        <div className="overflow-hidden rounded-xl border border-cream-200">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-cream-600 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-heading">倉庫</th>
                <th className="text-left px-4 py-3 font-heading">システム</th>
                <th className="text-left px-4 py-3 font-heading">ecforce state</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-100">
              <tr>
                <td className="px-4 py-3 font-bold text-cream-900">塚本郵便逓送</td>
                <td className="px-4 py-3 text-cream-600">COOOLa</td>
                <td className="px-4 py-3"><code className="px-2 py-1 bg-blue-50 text-blue-700 rounded">cooolawait</code></td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold text-cream-900">FJロジ</td>
                <td className="px-4 py-3 text-cream-600">コマロボ</td>
                <td className="px-4 py-3"><code className="px-2 py-1 bg-green-50 text-green-700 rounded">wmswait</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </RuleSection>
    </div>
  );
}

function RecoveryPage() {
  return (
    <div className="space-y-5">
      <RuleSection eyebrow="Retry" title="処理別の再試行">
        <div className="space-y-3">
          {[
            { title: 'ecforce共通API', value: '429を最大3回', note: '3秒、6秒、9秒待機して再試行' },
            { title: '出荷登録', value: '失敗分を最大2回', note: '初回を含め最大3回試行' },
            { title: '住所書き戻し', value: '429・5xxを最大6回', note: '最低1.3秒間隔、指数バックオフ' },
            { title: '住所AI校正', value: '3件ずつ並列処理', note: '失敗した住所はエラーとして結果に保持' },
          ].map((row) => (
            <div key={row.title} className="rounded-xl border border-cream-200 bg-cream-50 p-4 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
              <div className="w-40 text-sm font-heading font-bold text-cream-900">{row.title}</div>
              <div className="flex-1">
                <p className="text-sm font-mono text-accent font-bold">{row.value}</p>
                <p className="text-xs text-cream-500 mt-1">{row.note}</p>
              </div>
            </div>
          ))}
        </div>
      </RuleSection>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Notice tone="warning" title="受注が再取得できない場合">
          発送予定日の変更や対象外への状態変更が考えられます。差分ありとして出荷選択から除外し、ecforceで受注を確認します。
        </Notice>
        <Notice tone="info" title="セッション履歴">
          正常完了したセッションは担当者、出荷日、倉庫、タスク結果とともに履歴へ保存されます。
        </Notice>
      </div>
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
      default: return <OverviewPage />;
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-cream-100">
      <div className="max-w-7xl mx-auto p-6">
        <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cream-900 to-cream-700 text-white p-6 md:p-8 shadow-lg mb-5">
          <div className="absolute -right-12 -top-16 w-56 h-56 rounded-full bg-white/5" />
          <div className="absolute right-20 -bottom-24 w-48 h-48 rounded-full bg-accent/20" />
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-heading font-semibold mb-3">
              <BookOpen size={14} /> SHIPPING RULEBOOK
            </div>
            <h2 className="font-heading font-bold text-2xl md:text-3xl">出荷ルール</h2>
            <p className="text-sm text-white/75 leading-6 mt-2">
              出荷日・倉庫・確認タスク・住所校正・出荷登録の判断基準を、計算式と具体例で確認できます。
            </p>
            <div className="relative mt-5 max-w-xl">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例：夕の部、FJロジ、住所校正、決済エラー"
                className="w-full rounded-xl bg-white text-cream-900 placeholder-cream-400 pl-10 pr-4 py-3 text-sm border-0 focus:outline-none focus:ring-2 focus:ring-accent/40 shadow-sm"
              />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <aside className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-cream-200 shadow-sm p-2 lg:sticky lg:top-6">
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-heading font-bold text-cream-500 uppercase tracking-wider">カテゴリ</span>
                <span className="text-[10px] text-cream-400">{filteredCategories.length}件</span>
              </div>
              <nav className="space-y-1">
                {filteredCategories.map((category) => {
                  const Icon = category.icon;
                  const selected = category.id === active.id;
                  return (
                    <button
                      key={category.id}
                      onClick={() => setActiveId(category.id)}
                      className={`w-full rounded-xl px-3 py-3 text-left flex items-start gap-3 transition-colors ${
                        selected
                          ? 'bg-accent text-white shadow-sm'
                          : 'text-cream-700 hover:bg-cream-100'
                      }`}
                    >
                      <Icon size={18} className={`shrink-0 mt-0.5 ${selected ? 'text-white' : 'text-accent'}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-heading font-bold">{category.title}</span>
                        <span className={`block text-[10px] mt-0.5 truncate ${selected ? 'text-white/70' : 'text-cream-400'}`}>
                          {category.short}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </nav>
              {filteredCategories.length === 0 && (
                <div className="py-8 px-4 text-center">
                  <Search size={24} className="mx-auto text-cream-300 mb-2" />
                  <p className="text-xs text-cream-500">該当するカテゴリがありません</p>
                </div>
              )}
            </div>
          </aside>

          <main className="lg:col-span-3 min-w-0">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <ActiveIcon size={21} />
              </div>
              <div>
                <div className="flex items-center gap-2 text-[10px] text-cream-400 uppercase tracking-wider font-heading font-bold">
                  出荷ルール <ChevronRight size={12} /> {active.short}
                </div>
                <h2 className="text-xl font-heading font-bold text-cream-900 mt-1">{active.title}</h2>
                <p className="text-xs text-cream-500 leading-5 mt-1">{active.description}</p>
              </div>
            </div>
            {renderActivePage()}
          </main>
        </div>

        <footer className="mt-6 flex items-center justify-between gap-3 text-[11px] text-cream-400">
          <span className="flex items-center gap-1.5"><Clock3 size={13} /> 現行のstaging実装に基づくルール</span>
          <span>判断に迷った場合は管理者へ確認してください</span>
        </footer>
      </div>
    </div>
  );
}

