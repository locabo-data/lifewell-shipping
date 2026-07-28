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
    title: '驕主悉蜃ｺ闕ｷ蛻・｢ｺ隱・,
    icon: History,
    tone: 'amber',
    condition: '蜃ｺ闕ｷ蟇ｾ雎｡譌･縺ｮ15譌･蜑阪懷燕譌･',
    detail: 'state=complete縲∵ｱｺ貂医′莉ｮ螢ｲ荳翫∪縺溘・荳惹ｿ｡蟇ｩ譟ｻ螳御ｺ・∵悴蜃ｺ闕ｷ縲∬ｦ∝ｯｾ蠢懊ヵ繝ｩ繧ｰ縺ｪ縺励・蜿玲ｳｨ縲・,
    action: '逋ｺ騾∵律繧貞ｽ捺律縺ｫ螟画峩縺励・壼ｸｸ蜃ｺ闕ｷ繝ｪ繧ｹ繝医∈霑ｽ蜉縺励∪縺吶・,
  },
  {
    number: '02',
    title: '豎ｺ貂医お繝ｩ繝ｼ遒ｺ隱・,
    icon: CreditCard,
    tone: 'red',
    condition: '豎ｺ貂医お繝ｩ繝ｼ邉ｻ縺ｮpayment_state',
    detail: '荳惹ｿ｡螟ｱ謨励・螢ｲ荳雁､ｱ謨励・豎ｺ貂医お繝ｩ繝ｼ繝ｻ蜃ｦ逅・､ｱ謨励↑縺ｩ10遞ｮ鬘槭・迥ｶ諷九ｒ讀懷・縺励∪縺吶・,
    action: '菫晉蕗縲∝ｮ壽悄蛛懈ｭ｢縲∬ｦ∝ｯｾ蠢懆ｨｭ螳壹・｡ｧ螳｢騾｣邨｡繧定｡後＞縺ｾ縺吶・,
  },
  {
    number: '03',
    title: 'NP蛻･騾∫｢ｺ隱・,
    icon: FileSearch,
    tone: 'blue',
    condition: '謾ｯ謇墓婿豕肘D 57 / 24 / 61',
    detail: 'NP蠕梧鴛縺・・隲区ｱよ嶌蛻･騾∝ｯｾ雎｡繧剃ｸ隕ｧ縺ｫ縺励∪縺吶・,
    action: '蠢・ｦ√↑譯亥・縺ｨ蜀・ｮｹ遒ｺ隱阪ｒ陦後＞縲∝撫鬘後↑縺代ｌ縺ｰ螳御ｺ・＠縺ｾ縺吶・,
  },
  {
    number: '04',
    title: '繝・せ繝域ｳｨ譁・・豌丞錐荳榊ｙ',
    icon: UserRoundSearch,
    tone: 'violet',
    condition: '蛻晏屓豕ｨ譁・ｼ・imes 竕､ 1・・,
    detail: '繝・せ繝郁ｪ槭∵焚蟄励・險伜捷縺ｮ縺ｿ縲∵ｬ關ｽ縲∽ｸ崎・辟ｶ縺ｪ譁・ｭ怜・縲＾-PLUX縺ｮ繝輔Μ繧ｬ繝贋ｸ榊ｙ繧呈､懷・縺励∪縺吶・,
    action: '繝・せ繝域ｳｨ譁・・繧ｭ繝｣繝ｳ繧ｻ繝ｫ縺励∵ｰ丞錐繝溘せ縺ｯ豁｣縺励＞豌丞錐縺ｸ菫ｮ豁｣縺励∪縺吶・,
  },
  {
    number: '05',
    title: '驥崎､・ｳｨ譁・｢ｺ隱・,
    icon: Users,
    tone: 'orange',
    condition: '蜷御ｸ繧ｻ繝・す繝ｧ繝ｳ蜀・・豌丞錐縺ｾ縺溘・菴乗園縺御ｸ閾ｴ',
    detail: '蜈ｨ隗貞濠隗偵・遨ｺ逋ｽ繝ｻ繝上う繝輔Φ繧呈ｭ｣隕丞喧縺励※豈碑ｼ・＠縲∽ｽ乗園荳閾ｴ繧貞━蜈医＠縺ｾ縺吶・,
    action: '鬘ｧ螳｢縺ｫ遒ｺ隱阪＠縲・㍾隍・→遒ｺ螳壹＠縺溷女豕ｨ繧偵く繝｣繝ｳ繧ｻ繝ｫ縺励∪縺吶・,
  },
  {
    number: '06',
    title: '蜊伜刀豕ｨ譁・｢ｺ隱・,
    icon: ShoppingBag,
    tone: 'teal',
    condition: '險ｭ螳壽ｸ医∩縺ｮ蝠・刀繧ｳ繝ｼ繝峨ｒ蜷ｫ繧',
    detail: '蟇ｾ雎｡SKU繧貞性繧蜿玲ｳｨ繧偵∵欠螳壹＆繧後◆蛟牙ｺｫ縺ｮ繧､繝ｬ繧ｮ繝･繝ｩ繝ｼ繧ｰ繝ｫ繝ｼ繝励∈謖ｯ繧雁・縺代∪縺吶・,
    action: '蝠・刀縺ｨ蛟牙ｺｫ繧堤｢ｺ隱阪＠縲∵欠螳壼牙ｺｫ縺ｮ蜃ｺ闕ｷ蜃ｦ逅・∈騾ｲ繧√∪縺吶・,
  },
  {
    number: '07',
    title: '雉ｼ蜈･URL遒ｺ隱・,
    icon: Link,
    tone: 'pink',
    condition: 'times=1 縺九▽ URL縺ｫdefo / test',
    detail: '繝・せ繝育畑繝ｻ遒ｺ隱咲畑URL縺九ｉ豬∝・縺励◆蛻晏屓蜿玲ｳｨ繧呈､懷・縺励∪縺吶・,
    action: '譛ｬ逡ｪ蜃ｺ闕ｷ縺悟ｿ・ｦ√°遒ｺ隱阪＠縲∽ｸ崎ｦ√↑繧峨く繝｣繝ｳ繧ｻ繝ｫ縺励∪縺吶・,
  },
  {
    number: '08',
    title: '菴乗園譬｡豁｣',
    icon: MapPin,
    tone: 'green',
    condition: '蛻晏屓豕ｨ譁・ｼ・imes 竕､ 1・・,
    detail: '莠句燕譬｡豁｣繧ｭ繝｣繝・す繝･繧貞━蜈医＠縲∵悴譬｡豁｣菴乗園縺縺羨I縺ｧ譬｡豁｣縺励∪縺吶・,
    action: 'Review繝ｻNG縺ｨ螟画峩蜀・ｮｹ繧堤岼隕也｢ｺ隱阪＠縺ｦ縺九ｉecforce縺ｸ蜿肴丐縺励∪縺吶・,
  },
  {
    number: '09',
    title: 'O-PLUX蟇ｩ譟ｻ遒ｺ隱・,
    icon: ShieldCheck,
    tone: 'indigo',
    condition: 'times=1縲ヽEVIEW縺ｾ縺溘・隧ｳ邏ｰ縺ゅｊ縺ｮOK',
    detail: 'REVIEW縺ｯ蟶ｸ縺ｫ陦ｨ遉ｺ縺励＾K縺ｯ蟇ｩ譟ｻ隧ｳ邏ｰ縺後≠繧句ｴ蜷医□縺題｡ｨ遉ｺ縺励∪縺吶・G縺ｯ蟇ｾ雎｡螟悶〒縺吶・,
    action: '蟇ｩ譟ｻ隧ｳ邏ｰ繧定ｪｭ縺ｿ縲∝・闕ｷ繝ｻ菫晉蕗繝ｻ繧ｭ繝｣繝ｳ繧ｻ繝ｫ繧貞愛譁ｭ縺励∪縺吶・,
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
    title: '蜈ｨ菴薙・豬√ｌ',
    short: '縺ｾ縺壹・縺薙■繧・,
    description: '蜃ｺ闕ｷ繧ｻ繝・す繝ｧ繝ｳ髢句ｧ九°繧牙・闕ｷ逋ｻ骭ｲ縺ｾ縺ｧ縺ｮ蜈ｨ菴灘ワ',
    keywords: '縺ｯ縺倥ａ縺ｫ 繧ｻ繝・す繝ｧ繝ｳ 豬√ｌ 螳御ｺ・,
    icon: BookOpen,
  },
  {
    id: 'calendar',
    title: '蜃ｺ闕ｷ譌･繝ｻ蛟牙ｺｫ',
    short: '譌･莉倥→蛟牙ｺｫ蛻､螳・,
    description: '譏ｼ繝ｻ螟輔・蜃ｺ闕ｷ譌･縺ｨ縲∝ｹｳ譌･繝ｻ蝨滓律逾昴・蛟牙ｺｫ險育ｮ・,
    keywords: '譏ｼ 螟・鄙梧律 蟷ｳ譌･ 蝨滓律 逾晄律 FJ 蝪壽悽 COOOLa 繧ｳ繝槭Ο繝・,
    icon: CalendarDays,
  },
  {
    id: 'orders',
    title: '蟇ｾ雎｡蜿玲ｳｨ',
    short: '謚ｽ蜃ｺ縺ｨ莉ｶ謨ｰ',
    description: 'ecforce縺九ｉ蜿門ｾ励☆繧区擅莉ｶ縺ｨ騾壼ｸｸ繝ｻ繧､繝ｬ繧ｮ繝･繝ｩ繝ｼ縺ｮ蛻・｡・,
    keywords: '蜿玲ｳｨ complete tbc times 譁ｰ隕・譌｢蟄・繧､繝ｬ繧ｮ繝･繝ｩ繝ｼ 蝠・刀繧ｳ繝ｼ繝・,
    icon: Package,
  },
  {
    id: 'tasks',
    title: '9縺､縺ｮ遒ｺ隱阪ち繧ｹ繧ｯ',
    short: '讀懷・譚｡莉ｶ縺ｨ蟇ｾ蠢・,
    description: '蜷・ち繧ｹ繧ｯ縺御ｽ輔ｒ讀懷・縺励∽ｽ懈･ｭ閠・′菴輔ｒ縺吶ｋ縺・,
    keywords: TASKS.map((task) => `${task.title} ${task.condition}`).join(' '),
    icon: ListChecks,
  },
  {
    id: 'address',
    title: '菴乗園譬｡豁｣',
    short: 'AI蛻､螳壹→菴乗園蜿肴丐',
    description: 'OK繝ｻReview繝ｻNG縺ｨecforce菴乗園繝輔ぅ繝ｼ繝ｫ繝峨・蝗ｺ螳壹Ν繝ｼ繝ｫ',
    keywords: '菴乗園 AI OK Review NG addr01 addr02 zip 驛ｵ萓ｿ逡ｪ蜿ｷ 驛ｽ驕灘ｺ懃恁',
    icon: MapPin,
  },
  {
    id: 'shipping',
    title: '蜃ｺ闕ｷ逋ｻ骭ｲ',
    short: '逋ｻ骭ｲ蜿ｯ蜷ｦ縺ｨstate',
    description: '蟾ｮ蛻・メ繧ｧ繝・け縲∫匳骭ｲ譚｡莉ｶ縲∝牙ｺｫ蛻･縺ｮecforce譖ｴ譁ｰ蛟､',
    keywords: '蜃ｺ闕ｷ 蟾ｮ蛻・complete authed credit_exam_completed cooolawait wmswait',
    icon: Truck,
  },
  {
    id: 'recovery',
    title: '繧ｨ繝ｩ繝ｼ繝ｻ蜀崎ｩｦ陦・,
    short: '螟ｱ謨玲凾縺ｮ蜍輔″',
    description: 'API螟ｱ謨励√Ξ繝ｼ繝亥宛髯舌∝・螳溯｡後・繝ｫ繝ｼ繝ｫ',
    keywords: '繧ｨ繝ｩ繝ｼ 429 500 蜀崎ｩｦ陦・繝ｪ繝医Λ繧､ API 螟ｱ謨・,
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
      <RuleSection eyebrow="Overview" title="蜃ｺ闕ｷ讌ｭ蜍吶・5縺､縺ｮ谿ｵ髫弱〒騾ｲ縺ｿ縺ｾ縺・>
        <Flow items={[
          { title: '繧ｻ繝・す繝ｧ繝ｳ髢句ｧ・, text: '譌･莉倥・譏ｼ螟輔・諡・ｽ楢・ｒ謖・ｮ・ },
          { title: '蜿玲ｳｨ繧呈歓蜃ｺ', text: '蟇ｾ雎｡譌･縺ｨ迥ｶ諷九〒ecforce讀懃ｴ｢' },
          { title: '9繧ｿ繧ｹ繧ｯ遒ｺ隱・, text: '逡ｰ蟶ｸ繝ｻ隕∫｢ｺ隱榊女豕ｨ繧貞・逅・ },
          { title: '蟾ｮ蛻・メ繧ｧ繝・け', text: '菴懈･ｭ荳ｭ縺ｮ迥ｶ諷句､画峩繧貞・遒ｺ隱・ },
          { title: '蜃ｺ闕ｷ逋ｻ骭ｲ', text: '蛟牙ｺｫ蛻･state繧弾cforce縺ｸ蜿肴丐' },
        ]} />
      </RuleSection>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RuleSection title="繧ｻ繝・す繝ｧ繝ｳ螳御ｺ・・譚｡莉ｶ">
          <Formula label="繧ｿ繧ｹ繧ｯ螳御ｺ・愛螳・>
            {'蜈ｨ繧ｿ繧ｹ繧ｯ螳御ｺ・n= 9繧ｿ繧ｹ繧ｯ縺吶∋縺ｦ縺後悟ｮ御ｺ・阪∪縺溘・縲後せ繧ｭ繝・・縲・}
          </Formula>
        </RuleSection>
        <RuleSection title="逕ｻ髱｢荳翫・迥ｶ諷・>
          <div className="space-y-2 text-xs">
            {[
              ['騾ｲ陦御ｸｭ', '蜷・｢ｺ隱阪ち繧ｹ繧ｯ繧貞・逅・＠縺ｦ縺・ｋ迥ｶ諷・, 'bg-blue-100 text-blue-700'],
              ['繝√ぉ繝・け螳御ｺ・, '9繧ｿ繧ｹ繧ｯ螳御ｺ・ょｷｮ蛻・｢ｺ隱阪→蜃ｺ闕ｷ逋ｻ骭ｲ縺ｸ', 'bg-green-100 text-green-700'],
              ['蜃ｺ闕ｷ螳御ｺ・, '縺吶∋縺ｦ縺ｮ蛟牙ｺｫ繧ｰ繝ｫ繝ｼ繝励・逋ｻ骭ｲ縺梧・蜉・, 'bg-green-600 text-white'],
            ].map(([label, text, classes]) => (
              <div key={label} className="flex items-center gap-3 p-3 rounded-lg bg-cream-50">
                <span className={`px-2 py-1 rounded-full font-heading font-bold whitespace-nowrap ${classes}`}>{label}</span>
                <span className="text-cream-600 leading-5">{text}</span>
              </div>
            ))}
          </div>
        </RuleSection>
      </div>
      <Notice tone="info" title="縺薙・繝壹・繧ｸ縺ｮ蠖ｹ蜑ｲ">
        縺薙・繝ｫ繝ｼ繝ｫ繝悶ャ繧ｯ縺ｯ縲√す繧ｹ繝・Β縺後←縺ｮ譚｡莉ｶ縺ｧ蜿玲ｳｨ繧呈歓蜃ｺ繝ｻ蛻､螳壹・譖ｴ譁ｰ縺吶ｋ縺九ｒ隱ｬ譏弱＠縺ｾ縺吶・        螳滄圀縺ｮ蛻､譁ｭ縺ｫ霑ｷ縺｣縺溷ｴ蜷医・縲∝推繧ｿ繧ｹ繧ｯ縺ｮ縲悟ｯｾ雎｡譚｡莉ｶ縲阪→縲御ｽ懈･ｭ閠・・蟇ｾ蠢懊阪ｒ遒ｺ隱阪＠縺ｦ縺上□縺輔＞縲・      </Notice>
    </div>
  );
}

function CalendarPage({ isAdmin, onNavigate }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RuleSection eyebrow="Shipping date" title="蜃ｺ闕ｷ蟇ｾ雎｡譌･縺ｮ險育ｮ・>
          <Formula label="譏ｼ縺ｮ驛ｨ">
            {'蜃ｺ闕ｷ蟇ｾ雎｡譌･ = 繧ｫ繝ｬ繝ｳ繝繝ｼ縺ｧ驕ｸ謚槭＠縺滓律'}
          </Formula>
          <div className="h-3" />
          <Formula label="螟輔・驛ｨ" note="蛟牙ｺｫ蛻､螳壹↓繧らｿ梧律縺ｮ譖懈律繝ｻ逾晄律繧剃ｽｿ縺・∪縺吶・>
            {'蜃ｺ闕ｷ蟇ｾ雎｡譌･ = 繧ｫ繝ｬ繝ｳ繝繝ｼ縺ｧ驕ｸ謚槭＠縺滓律 + 1譌･'}
          </Formula>
        </RuleSection>
        <RuleSection eyebrow="Warehouse" title="蛟牙ｺｫ縺ｮ蜆ｪ蜈磯・ｽ・>
          <div className="space-y-3">
            {[
              ['1', '謇句虚謖・ｮ・, '蛟牙ｺｫ繧ｫ繝ｬ繝ｳ繝繝ｼ縺ｮ謖・ｮ壹ｒ譛蜆ｪ蜈・],
              ['2', '蝨滓律繝ｻ逾晄律', 'FJ繝ｭ繧ｸ / 繧ｳ繝槭Ο繝・],
              ['3', '騾壼ｸｸ縺ｮ蟷ｳ譌･', '蝪壽悽驛ｵ萓ｿ騾馴・/ COOOLa'],
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
      <RuleSection title="蜈ｷ菴謎ｾ・>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { date: '蟷ｳ譌･繝ｻ譏ｼ縺ｮ驛ｨ', result: '蠖捺律 竊・蝪壽悽', sub: 'COOOLa縺ｧ蜃ｺ闕ｷ逋ｻ骭ｲ' },
            { date: '驥第屆繝ｻ螟輔・驛ｨ', result: '蝨滓屆 竊・FJ繝ｭ繧ｸ', sub: '鄙梧律蝓ｺ貅悶〒蛻､螳・ },
            { date: '逾晏燕譌･繝ｻ螟輔・驛ｨ', result: '逾晄律 竊・FJ繝ｭ繧ｸ', sub: '逋ｻ骭ｲ逾晄律繧貞盾辣ｧ' },
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
          <Warehouse size={17} /> 蛟牙ｺｫ繧ｫ繝ｬ繝ｳ繝繝ｼ繧堤｢ｺ隱阪・螟画峩
        </button>
      )}
    </div>
  );
}

function OrdersPage({ isAdmin, onNavigate }) {
  return (
    <div className="space-y-5">
      <RuleSection eyebrow="Fetch" title="ecforce縺九ｉ蜿門ｾ励☆繧区擅莉ｶ">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            ['蜿玲ｳｨ迥ｶ諷・, 'state = complete'],
            ['逋ｺ騾∽ｺ亥ｮ壽律', '蟇ｾ雎｡譌･縺ｮ00:00縲・3:59'],
            ['蜿門ｾ怜腰菴・, '100莉ｶ縺壹▽蜈ｨ繝壹・繧ｸ'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-cream-50 border border-cream-200 p-4">
              <p className="text-xs text-cream-500">{label}</p>
              <code className="block text-sm font-mono font-bold text-cream-900 mt-2">{value}</code>
            </div>
          ))}
        </div>
      </RuleSection>
      <RuleSection eyebrow="Filter" title="蜿門ｾ怜ｾ後・蛻・｡・>
        <Flow items={[
          { title: '蜈ｨ蜿玲ｳｨ', text: '蟇ｾ雎｡譌･縺ｮcomplete繧貞叙蠕・ },
          { title: '蛻晏屓蛻､螳・, text: 'times 竕､ 1 繧呈眠隕乗桶縺・ },
          { title: '隕∝ｯｾ蠢憺勁螟・, text: 'tbc=true繧帝壼ｸｸ繝輔Ο繝ｼ縺九ｉ髯､螟・ },
          { title: 'SKU蛻､螳・, text: '險ｭ螳壹さ繝ｼ繝峨ｒ謖・ｮ壼牙ｺｫ縺ｸ蛻・屬' },
          { title: '騾壼ｸｸ蜿玲ｳｨ', text: '9縺､縺ｮ遒ｺ隱阪ち繧ｹ繧ｯ縺ｸ' },
        ]} />
      </RuleSection>
      <RuleSection title="莉ｶ謨ｰ縺ｮ險育ｮ・>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Formula label="騾壼ｸｸ蜿玲ｳｨ謨ｰ">{'API蜿門ｾ玲焚 - 隕∝ｯｾ蠢懷女豕ｨ - 繧､繝ｬ繧ｮ繝･繝ｩ繝ｼ蜿玲ｳｨ'}</Formula>
          <Formula label="譁ｰ隕丈ｻｶ謨ｰ">{'騾壼ｸｸ蜿玲ｳｨ縺ｮ縺・■ times 竕､ 1'}</Formula>
          <Formula label="譌｢蟄倅ｻｶ謨ｰ">{'騾壼ｸｸ蜿玲ｳｨ謨ｰ - 譁ｰ隕丈ｻｶ謨ｰ'}</Formula>
        </div>
      </RuleSection>
      <Notice tone="warning" title="times縺悟叙蠕励〒縺阪↑縺・ｴ蜷・>
        迴ｾ陦後Ο繧ｸ繝・け縺ｧ縺ｯtimes縺後↑縺・女豕ｨ縺ｯ0縺ｨ縺励※謇ｱ繧上ｌ繧九◆繧√∝・蝗槫女豕ｨ縺ｫ蛻・｡槭＆繧後∪縺吶・      </Notice>
      {isAdmin && (
        <button onClick={() => onNavigate('settings')}
          className="w-full rounded-xl border border-accent/30 bg-accent/5 hover:bg-accent/10 px-4 py-3 flex items-center justify-center gap-2 text-sm font-heading font-bold text-accent transition-colors">
          <ShoppingBag size={17} /> 繧､繝ｬ繧ｮ繝･繝ｩ繝ｼ蝠・刀險ｭ螳壹ｒ遒ｺ隱・        </button>
      )}
    </div>
  );
}

function TasksPage() {
  return (
    <div className="space-y-5">
      <Notice tone="info" title="繧ｿ繧ｹ繧ｯ縺ｯ騾壼ｸｸ蜿玲ｳｨ縺ｫ蟇ｾ縺励※險育ｮ励＆繧後∪縺・>
        隕∝ｯｾ蠢懷女豕ｨ縺ｨ蛟牙ｺｫ蛻･繧､繝ｬ繧ｮ繝･繝ｩ繝ｼ蜿玲ｳｨ繧帝勁縺・◆縺ゅ→縲∝推繧ｿ繧ｹ繧ｯ縺ｮ譚｡莉ｶ繧堤峡遶九＠縺ｦ蛻､螳壹＠縺ｾ縺吶・        蜷後§蜿玲ｳｨ縺瑚､・焚縺ｮ繧ｿ繧ｹ繧ｯ縺ｫ陦ｨ遉ｺ縺輔ｌ繧九％縺ｨ縺後≠繧翫∪縺吶・      </Notice>
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
                <p className="text-xs text-cream-600 leading-5"><span className="font-bold text-cream-800">蟇ｾ蠢懶ｼ・/span>{task.action}</p>
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
      <RuleSection eyebrow="AI correction" title="菴乗園譬｡豁｣縺ｮ蛻､螳・>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            ['OK', '驟埼∽ｸ雁撫鬘後↑縺・, 'bg-green-50 border-green-200 text-green-700'],
            ['Review', '逶ｮ隕也｢ｺ隱阪′蠢・ｦ・, 'bg-amber-50 border-amber-200 text-amber-700'],
            ['NG', '荳榊ｙ繝ｻ驟埼√Μ繧ｹ繧ｯ縺碁ｫ倥＞', 'bg-red-50 border-red-200 text-red-700'],
          ].map(([score, text, classes]) => (
            <div key={score} className={`rounded-xl border p-4 ${classes}`}>
              <p className="text-lg font-heading font-bold">{score}</p>
              <p className="text-xs mt-1">{text}</p>
            </div>
          ))}
        </div>
      </RuleSection>
      <RuleSection eyebrow="Fixed mapping" title="ecforce縺ｸ騾√ｋ菴乗園縺ｮ邨・∩遶九※">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Formula label="addr01・亥ｸょ玄逕ｺ譚代・逕ｺ蜷搾ｼ・>{'addr01 = city + town'}</Formula>
          <Formula label="addr02・育分蝨ｰ繝ｻ蟒ｺ迚ｩ・・>{'addr02 = chome-banchi-go\n        + 蜊願ｧ偵せ繝壹・繧ｹ\n        + building + building_number'}</Formula>
          <Formula label="驛ｵ萓ｿ逡ｪ蜿ｷ">{'zip01 = 荳・譯―nzip02 = 荳・譯・}</Formula>
          <Formula label="譖ｴ譁ｰ蟇ｾ雎｡">{'豕ｨ譁・ｼ夐・騾∝・ + 隲区ｱょ・\n螳壽悄・夐・騾∝・\n鬘ｧ螳｢・夊ｫ区ｱょ・'}</Formula>
        </div>
      </RuleSection>
      <Notice tone="danger" title="螟画峩遖∵ｭ｢縺ｮ菴乗園繝ｫ繝ｼ繝ｫ">
        <ul className="list-disc pl-4 space-y-1">
          <li>addr01縺ｫ驛ｽ驕灘ｺ懃恁繧貞性繧√∪縺帙ｓ縲・/li>
          <li>驛ｽ驕灘ｺ懃恁縺ｯecforce縺ｮ迴ｾ蝨ｨ蛟､繧堤ｶｭ謖√＠縲∵峩譁ｰ縺励∪縺帙ｓ縲・/li>
          <li>prefecture_id縺ｯ蜴溷援縺ｨ縺励※騾∽ｿ｡縺励∪縺帙ｓ縲・/li>
          <li>Review繝ｻNG縺ｯ蜿肴丐蜑阪↓蠢・★譬｡豁｣蠕御ｽ乗園繧堤岼隕也｢ｺ隱阪＠縺ｾ縺吶・/li>
        </ul>
      </Notice>
    </div>
  );
}

function ShippingPage() {
  return (
    <div className="space-y-5">
      <RuleSection eyebrow="Recheck" title="繧ｿ繧ｹ繧ｯ螳御ｺ・ｾ後・蟾ｮ蛻・メ繧ｧ繝・け">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['state', 'payment_state', 'tbc', 'human_state'].map((field) => (
            <div key={field} className="rounded-xl border border-cream-200 bg-cream-50 p-4 text-center">
              <code className="text-xs font-mono font-bold text-cream-800">{field}</code>
            </div>
          ))}
        </div>
        <p className="text-xs text-cream-500 leading-6 mt-4">
          state繝ｻpayment_state繝ｻtbc縺ｫ螟画峩縺後≠繧句女豕ｨ縲√∪縺溘・API縺九ｉ蜿門ｾ励〒縺阪↑縺上↑縺｣縺溷女豕ｨ縺ｯ縲・          蜃ｺ闕ｷ縺ｫ蠖ｱ髻ｿ縺吶ｋ螟画峩縺ｨ縺励※蜃ｺ闕ｷ驕ｸ謚槭°繧芽・蜍暮勁螟悶＆繧後∪縺吶・        </p>
      </RuleSection>
      <RuleSection eyebrow="Eligibility" title="蜃ｺ闕ｷ逋ｻ骭ｲ縺ｧ縺阪ｋ譚｡莉ｶ">
        <Formula label="逋ｻ骭ｲ蜿ｯ蜷ｦ">
          {'state = complete\n縺九▽\npayment_state = credit_exam_completed 縺ｾ縺溘・ authed'}
        </Formula>
      </RuleSection>
      <RuleSection title="蛟牙ｺｫ蛻･縺ｮecforce譖ｴ譁ｰ蛟､">
        <div className="overflow-hidden rounded-xl border border-cream-200">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-cream-600 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-heading">蛟牙ｺｫ</th>
                <th className="text-left px-4 py-3 font-heading">繧ｷ繧ｹ繝・Β</th>
                <th className="text-left px-4 py-3 font-heading">ecforce state</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-100">
              <tr>
                <td className="px-4 py-3 font-bold text-cream-900">蝪壽悽驛ｵ萓ｿ騾馴・/td>
                <td className="px-4 py-3 text-cream-600">COOOLa</td>
                <td className="px-4 py-3"><code className="px-2 py-1 bg-blue-50 text-blue-700 rounded">cooolawait</code></td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-bold text-cream-900">FJ繝ｭ繧ｸ</td>
                <td className="px-4 py-3 text-cream-600">繧ｳ繝槭Ο繝・/td>
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
      <RuleSection eyebrow="Retry" title="蜃ｦ逅・挨縺ｮ蜀崎ｩｦ陦・>
        <div className="space-y-3">
          {[
            { title: 'ecforce蜈ｱ騾哂PI', value: '429繧呈怙螟ｧ3蝗・, note: '3遘偵・遘偵・遘貞ｾ・ｩ溘＠縺ｦ蜀崎ｩｦ陦・ },
            { title: '蜃ｺ闕ｷ逋ｻ骭ｲ', value: '螟ｱ謨怜・繧呈怙螟ｧ2蝗・, note: '蛻晏屓繧貞性繧∵怙螟ｧ3蝗櫁ｩｦ陦・ },
            { title: '菴乗園譖ｸ縺肴綾縺・, value: '429繝ｻ5xx繧呈怙螟ｧ6蝗・, note: '譛菴・.3遘帝俣髫斐∵欠謨ｰ繝舌ャ繧ｯ繧ｪ繝・ },
            { title: '菴乗園AI譬｡豁｣', value: '3莉ｶ縺壹▽荳ｦ蛻怜・逅・, note: '螟ｱ謨励＠縺滉ｽ乗園縺ｯ繧ｨ繝ｩ繝ｼ縺ｨ縺励※邨先棡縺ｫ菫晄戟' },
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
        <Notice tone="warning" title="蜿玲ｳｨ縺悟・蜿門ｾ励〒縺阪↑縺・ｴ蜷・>
          逋ｺ騾∽ｺ亥ｮ壽律縺ｮ螟画峩繧・ｯｾ雎｡螟悶∈縺ｮ迥ｶ諷句､画峩縺瑚・∴繧峨ｌ縺ｾ縺吶ょｷｮ蛻・≠繧翫→縺励※蜃ｺ闕ｷ驕ｸ謚槭°繧蛾勁螟悶＠縲‘cforce縺ｧ蜿玲ｳｨ繧堤｢ｺ隱阪＠縺ｾ縺吶・        </Notice>
        <Notice tone="info" title="繧ｻ繝・す繝ｧ繝ｳ螻･豁ｴ">
          豁｣蟶ｸ螳御ｺ・＠縺溘そ繝・す繝ｧ繝ｳ縺ｯ諡・ｽ楢・∝・闕ｷ譌･縲∝牙ｺｫ縲√ち繧ｹ繧ｯ邨先棡縺ｨ縺ｨ繧ゅ↓螻･豁ｴ縺ｸ菫晏ｭ倥＆繧後∪縺吶・        </Notice>
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
            <h2 className="font-heading font-bold text-2xl md:text-3xl">蜃ｺ闕ｷ繝ｫ繝ｼ繝ｫ</h2>
            <p className="text-sm text-white/75 leading-6 mt-2">
              蜃ｺ闕ｷ譌･繝ｻ蛟牙ｺｫ繝ｻ遒ｺ隱阪ち繧ｹ繧ｯ繝ｻ菴乗園譬｡豁｣繝ｻ蜃ｺ闕ｷ逋ｻ骭ｲ縺ｮ蛻､譁ｭ蝓ｺ貅悶ｒ縲∬ｨ育ｮ怜ｼ上→蜈ｷ菴謎ｾ九〒遒ｺ隱阪〒縺阪∪縺吶・            </p>
            <div className="relative mt-5 max-w-xl">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="萓具ｼ壼､輔・驛ｨ縲：J繝ｭ繧ｸ縲∽ｽ乗園譬｡豁｣縲∵ｱｺ貂医お繝ｩ繝ｼ"
                className="w-full rounded-xl bg-white text-cream-900 placeholder-cream-400 pl-10 pr-4 py-3 text-sm border-0 focus:outline-none focus:ring-2 focus:ring-accent/40 shadow-sm"
              />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <aside className="lg:col-span-1">
            <div className="bg-white rounded-2xl border border-cream-200 shadow-sm p-2 lg:sticky lg:top-6">
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-heading font-bold text-cream-500 uppercase tracking-wider">繧ｫ繝・ざ繝ｪ</span>
                <span className="text-[10px] text-cream-400">{filteredCategories.length}莉ｶ</span>
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
                  <p className="text-xs text-cream-500">隧ｲ蠖薙☆繧九き繝・ざ繝ｪ縺後≠繧翫∪縺帙ｓ</p>
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
                  蜃ｺ闕ｷ繝ｫ繝ｼ繝ｫ <ChevronRight size={12} /> {active.short}
                </div>
                <h2 className="text-xl font-heading font-bold text-cream-900 mt-1">{active.title}</h2>
                <p className="text-xs text-cream-500 leading-5 mt-1">{active.description}</p>
              </div>
            </div>
            {renderActivePage()}
          </main>
        </div>

        <footer className="mt-6 flex items-center justify-between gap-3 text-[11px] text-cream-400">
          <span className="flex items-center gap-1.5"><Clock3 size={13} /> 迴ｾ陦後・staging螳溯｣・↓蝓ｺ縺･縺上Ν繝ｼ繝ｫ</span>
          <span>蛻､譁ｭ縺ｫ霑ｷ縺｣縺溷ｴ蜷医・邂｡逅・・∈遒ｺ隱阪＠縺ｦ縺上□縺輔＞</span>
        </footer>
      </div>
    </div>
  );
}

