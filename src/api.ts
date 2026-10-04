import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

export type FieldSource = 'server' | 'draft' | 'override' | 'signature';

/** 带修订号与来源的字段值：每个字段独立记录它基于哪个服务器修订、来自哪里 */
export type Versioned<T> = {
  value: T;
  /** 该字段值被写入时对应的服务器修订号 */
  revision: number;
  /** 来源：服务器基线 / 离线草稿 / 超差授权 / 阶段签署 */
  source: FieldSource;
  at: string;
  /** 客户端幂等键：写入失败重试时服务器据此去重，保证只生效一次 */
  clientId?: string;
};

export type OverrideRecord = {
  eo: string;
  basis: string;
  actor: string;
  /** 授权时工卡的版本号；工卡版本一旦变化，该授权立即作废 */
  revision: number;
  at: string;
};

export type CardStatus = '未开始' | '执行中' | '待授权' | '已完成';

export type ServerCard = {
  id: string;
  title: string;
  zone: string;
  revisionText: string;
  estimated: number;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  stage: string;
  status: CardStatus;
  measurement: Versioned<string>;
  finding: Versioned<string>;
  witnessConfirmed: Versioned<boolean>;
  override: Versioned<OverrideRecord> | null;
};

export type ServerSignature = {
  stage: string;
  status: '待签署' | '已签署';
  actor: string;
  time: string;
  revision: number;
  source: FieldSource;
};

export type WorkPackage = {
  id: string;
  aircraft: string;
  type: string;
  check: string;
  station: string;
  plannedStart: string;
  plannedEnd: string;
  revision: string;
  serverRevision: number;
  cards: ServerCard[];
  signatures: ServerSignature[];
};

export type EditableField = 'measurement' | 'finding' | 'witnessConfirmed';

export type FieldSubmit<T> = {
  value: T;
  /** 本地草稿所基于的修订号；服务器发现该字段已被更高修订写入时判定冲突 */
  baseRevision: number;
  /** 后到方看过差异后显式选择覆盖时置 true */
  force?: boolean;
};

export type SubmitArg = {
  cardId: string;
  /** 客户端生成的幂等键，重试不变 */
  clientId: string;
  fields?: Partial<Record<EditableField, FieldSubmit<string | boolean>>>;
  override?: OverrideRecord;
  signature?: { stage: string; actor: string; baseRevision: number; force?: boolean };
};

export type FieldConflict = {
  field: EditableField | 'signature';
  label: string;
  baseRevision: number;
  serverRevision: number;
  localValue: unknown;
  serverValue: unknown;
};

export type SubmitResult =
  | { kind: 'accepted'; revision: number; idempotent: boolean; applied: string[] }
  | { kind: 'conflict'; revision: number; conflicts: FieldConflict[]; overrideStale: boolean }
  | { kind: 'error'; message: string };

const v = <T,>(value: T, revision: number, source: FieldSource = 'server'): Versioned<T> => ({
  value,
  revision,
  source,
  at: '2026-09-29T09:00:00+08:00'
});

const seedCards: ServerCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', revisionText: 'R7', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', stage: '机械签署', status: '已完成', measurement: v('1.62 mm', 7), finding: v('正常', 7), witnessConfirmed: v(true, 7), override: null },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revisionText: 'R7', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', stage: '发动机签署', status: '执行中', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', revisionText: 'R6', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', stage: '系统签署', status: '待授权', measurement: v('2762 psi', 7), finding: v('低于容差，等待授权', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', revisionText: 'R7', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', stage: '适航签署', status: '已完成', measurement: v('剩余 836 循环', 7), finding: v('正常', 7), witnessConfirmed: v(true, 7), override: null },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', revisionText: 'R7', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', stage: '适航签署', status: '未开始', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', revisionText: 'R7', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', stage: '客舱签署', status: '未开始', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', revisionText: 'R5', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', stage: '动力签署', status: '未开始', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revisionText: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', stage: '放行签署', status: '执行中', measurement: v('发现 2 次压力偏低', 7), finding: v('移交可靠性分析', 7), witnessConfirmed: v(false, 7), override: null }
];

const packageData: WorkPackage = {
  id: 'WP-B7891-04',
  aircraft: 'B-7891',
  type: 'B737-800',
  check: '48A 定检',
  station: '上海浦东 · H3 机库',
  plannedStart: '2026-09-28 06:00',
  plannedEnd: '2026-09-30 18:00',
  revision: 'WP R7',
  serverRevision: 7,
  cards: seedCards,
  signatures: [
    { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18', revision: 7, source: 'server' },
    { stage: '系统', status: '待签署', actor: '待指定', time: '-', revision: 7, source: 'server' },
    { stage: '动力', status: '待签署', actor: '待指定', time: '-', revision: 7, source: 'server' },
    { stage: '放行', status: '待签署', actor: '质量经理', time: '-', revision: 7, source: 'server' }
  ]
};

/** 已应用的幂等键：clientId -> 已确认的修订号，重试时原样返回 accepted */
const appliedClients = new Map<string, number>();

const fieldLabels: Record<EditableField, string> = {
  measurement: '测量值',
  finding: '发现项',
  witnessConfirmed: '见证确认'
};

function applySignature(arg: SubmitArg): SubmitResult {
  const sigArg = arg.signature!;
  const sig = packageData.signatures.find((item) => item.stage === sigArg.stage);
  if (!sig) return { kind: 'error', message: '阶段签署不存在。' };

  const conflicts: FieldConflict[] = [];
  if (sig.status === '已签署' && sig.revision !== sigArg.baseRevision && !sigArg.force) {
    conflicts.push({
      field: 'signature',
      label: `${sigArg.stage}阶段签署`,
      baseRevision: sigArg.baseRevision,
      serverRevision: sig.revision,
      localValue: { status: '已签署', actor: sigArg.actor },
      serverValue: { status: '已签署', actor: sig.actor }
    });
  }
  if (conflicts.length) {
    return { kind: 'conflict', revision: packageData.serverRevision, conflicts, overrideStale: false };
  }

  const newRevision = packageData.serverRevision + 1;
  sig.status = '已签署';
  sig.actor = sigArg.actor;
  sig.time = new Date().toISOString();
  sig.revision = newRevision;
  sig.source = 'signature';
  packageData.serverRevision = newRevision;
  appliedClients.set(arg.clientId, newRevision);
  return { kind: 'accepted', revision: newRevision, idempotent: false, applied: ['signature'] };
}

function submitToServer(arg: SubmitArg): SubmitResult {
  // 幂等：同一 clientId 只生效一次，重试不重复写入
  if (appliedClients.has(arg.clientId)) {
    return { kind: 'accepted', revision: packageData.serverRevision, idempotent: true, applied: [] };
  }

  // 阶段签署不绑定具体工卡，单独走签署合并
  if (arg.signature) return applySignature(arg);

  const card = packageData.cards.find((item) => item.id === arg.cardId);
  if (!card) return { kind: 'error', message: '工卡不存在或已从工作包移除。' };

  const conflicts: FieldConflict[] = [];
  const defs: { key: EditableField; sub?: FieldSubmit<string | boolean> }[] = [
    { key: 'measurement', sub: arg.fields?.measurement },
    { key: 'finding', sub: arg.fields?.finding },
    { key: 'witnessConfirmed', sub: arg.fields?.witnessConfirmed }
  ];

  for (const def of defs) {
    if (!def.sub) continue;
    const current = card[def.key] as Versioned<string | boolean>;
    if (current.revision !== def.sub.baseRevision && !def.sub.force) {
      conflicts.push({
        field: def.key,
        label: fieldLabels[def.key],
        baseRevision: def.sub.baseRevision,
        serverRevision: current.revision,
        localValue: def.sub.value,
        serverValue: current.value
      });
    }
  }

  // 超差授权必须与工卡当前版本一起生效：版本对不上直接作废旧授权
  let overrideStale = false;
  if (arg.override && arg.override.revision !== packageData.serverRevision) {
    overrideStale = true;
  }

  if (conflicts.length || overrideStale) {
    return { kind: 'conflict', revision: packageData.serverRevision, conflicts, overrideStale };
  }

  const newRevision = packageData.serverRevision + 1;
  const now = new Date().toISOString();
  const applied: string[] = [];

  for (const def of defs) {
    if (!def.sub) continue;
    if (def.key === 'witnessConfirmed') {
      card.witnessConfirmed = { value: Boolean(def.sub.value), revision: newRevision, source: 'draft', at: now, clientId: arg.clientId };
    } else {
      card[def.key] = { value: String(def.sub.value), revision: newRevision, source: 'draft', at: now, clientId: arg.clientId };
    }
    applied.push(def.key);
  }
  if (arg.override) {
    card.override = { value: arg.override, revision: newRevision, source: 'override', at: now };
    card.status = '执行中';
    applied.push('override');
  }

  packageData.serverRevision = newRevision;
  appliedClients.set(arg.clientId, newRevision);
  return { kind: 'accepted', revision: newRevision, idempotent: false, applied };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mockBaseQuery: BaseQueryFn = async (arg) => {
  await delay(180);
  if (typeof arg === 'string' && arg === 'package') return { data: packageData };
  if (typeof arg === 'object' && arg !== null && 'url' in arg) {
    const request = arg as { url: string };
    if (request.url === 'package') return { data: packageData };
  }
  return { error: { status: 404, data: 'Not found' } };
};

export const maintenanceApi = createApi({
  reducerPath: 'maintenanceApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Package'],
  endpoints: (builder) => ({
    getWorkPackage: builder.query<WorkPackage, void>({
      query: () => 'package',
      providesTags: ['Package']
    }),
    submitCard: builder.mutation<SubmitResult, SubmitArg>({
      queryFn: async (arg) => {
        await delay(240);
        // 模拟偶发网络写入失败：失败时服务器未确认，客户端保留草稿与待合并改动，凭同一 clientId 重试
        if (Math.random() < 0.08) {
          return { data: { kind: 'error', message: '网络写入失败：服务器未确认。原草稿与待合并改动已保留，请重试（不会重复提交）。' } };
        }
        return { data: submitToServer(arg) };
      },
      invalidatesTags: ['Package']
    })
  })
});

export const { useGetWorkPackageQuery, useSubmitCardMutation } = maintenanceApi;
