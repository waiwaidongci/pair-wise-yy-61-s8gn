import { configureStore } from '@reduxjs/toolkit';
import { maintenanceApi, type ChangeDTO } from '../src/api';

const store = configureStore({
  reducer: { [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (g) => g().concat(maintenanceApi.middleware)
});
type RootState = ReturnType<typeof store.getState>;
const snap = () => (store.getState() as RootState)[maintenanceApi.reducerPath].queries;

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name} ${extra}`); }
};
const tok = (s: string) => `tok-${s}`;
const now = () => new Date().toISOString();
const mkField = (o: Partial<ChangeDTO>): ChangeDTO => ({
  token: tok(o.token ?? Math.random().toString(36).slice(2)),
  kind: 'field',
  cardId: 'CARD-02',
  field: 'measurement',
  value: '0.12 mm',
  baseValue: '',
  baseRev: 7,
  origin: 'test',
  device: 'dev',
  ...o
});

const sync = (changes: ChangeDTO[]) => store.dispatch(maintenanceApi.endpoints.syncChanges.initiate({ changes })).unwrap();
const getCard = (s: any, id: string) => s.tasks.find((c: any) => c.id === id);

(async () => {
  console.log('1) 字段基线匹配 → 接受，字段修订号递增');
  const s0 = await store.dispatch(maintenanceApi.endpoints.getWorkPackage.initiate()).unwrap();
  const revBefore = getCard(s0, 'CARD-02').fields.measurement.rev;
  const r1 = await sync([mkField({ token: 'a1' })]);
  check('accepted', r1.outcomes[0].result === 'accepted');
  check('服务器字段值更新', getCard(r1.snapshot, 'CARD-02').fields.measurement.value === '0.12 mm');
  check('字段修订号递增', getCard(r1.snapshot, 'CARD-02').fields.measurement.rev === revBefore + 1);
  check('字段带来源', getCard(r1.snapshot, 'CARD-02').fields.measurement.source === 'test');

  console.log('2) 后到方基线过期 → 冲突，不覆盖先到数据');
  const r2 = await sync([mkField({ token: 'b1', value: '0.99 mm', baseValue: '旧值-不存在' })]);
  check('conflict', r2.outcomes[0].result === 'conflict');
  check('先到数据保留', getCard(r2.snapshot, 'CARD-02').fields.measurement.value === '0.12 mm');
  check('冲突带回先到来源', Boolean(r2.outcomes[0].conflict?.serverSource));

  console.log('3) 后到方看差异后以新基线重提 → 接受');
  const serverRev = r2.outcomes[0].conflict!.serverRev;
  const r3 = await sync([mkField({ token: 'b2', value: '0.99 mm', baseValue: '0.12 mm', baseRev: serverRev })]);
  check('accepted after rebase', r3.outcomes[0].result === 'accepted');
  check('值更新为本方值', getCard(r3.snapshot, 'CARD-02').fields.measurement.value === '0.99 mm');

  console.log('4) 幂等：同一 token 重试只生效一次');
  const headBefore = r3.serverRevision;
  const r4 = await sync([mkField({ token: 'a1' })]);
  check('重试返回原结果', r4.outcomes[0].result === 'accepted');
  check('修订号不再增长（幂等）', r4.serverRevision === headBefore);

  console.log('5) 同值提交 noop，不产生修订');
  const r5 = await sync([mkField({ token: 'c1', value: getCard(r4.snapshot, 'CARD-02').fields.measurement.value, baseValue: '0.12 mm' })]);
  check('noop', r5.outcomes[0].result === 'noop');

  console.log('6) 超差授权必须与工卡版本一致；升版后旧确认作废');
  const card03 = getCard(r5.snapshot, 'CARD-03');
  check('CARD-03 当前 R6', card03.revision === 'R6' && card03.status === '待授权');
  const ov1 = await sync([{ token: tok('ov1'), kind: 'override', cardId: 'CARD-03', cardRev: 6, baseRev: r5.serverRevision, eo: 'EO-1', basis: 'b', origin: 'test', device: 'dev' }]);
  check('R6 授权接受', ov1.outcomes[0].result === 'accepted');
  check('接受后转执行中', getCard(ov1.snapshot, 'CARD-03').status === '执行中');
  await store.dispatch(maintenanceApi.endpoints.bumpCardRevision.initiate({ cardId: 'CARD-03' })).unwrap();
  const afterBump = await store.dispatch(maintenanceApi.endpoints.getWorkPackage.initiate(undefined, { forceRefetch: true })).unwrap();
  check('升版为 R7', getCard(afterBump, 'CARD-03').revision === 'R7');
  check('升版后回到待授权', getCard(afterBump, 'CARD-03').status === '待授权');
  const ov2 = await sync([{ token: tok('ov2'), kind: 'override', cardId: 'CARD-03', cardRev: 6, baseRev: afterBump.serverRevision, eo: 'EO-1', basis: 'b', origin: 'test', device: 'dev' }]);
  check('旧 R6 授权 staleOverride', ov2.outcomes[0].result === 'staleOverride');
  const ov3 = await sync([{ token: tok('ov3'), kind: 'override', cardId: 'CARD-03', cardRev: 7, baseRev: ov2.serverRevision, eo: 'EO-2', basis: 'b2', origin: 'test', device: 'dev' }]);
  check('R7 重新授权接受', ov3.outcomes[0].result === 'accepted');
  check('只有 R7 授权有效', ov3.snapshot.overrides.filter((o) => o.cardId === 'CARD-03').length === 2);

  console.log('7) 完成工卡：缺见证/超差版本不匹配被拒，重提完成后通过');
  const completeBase = (token: string, cardRev: number): ChangeDTO => ({ token, kind: 'complete', cardId: 'CARD-03', cardRev, baseRev: 0, origin: 'test', device: 'dev' });
  const co1 = await sync([completeBase(tok('co1'), 6)]);
  check('旧版本完成被拒', co1.outcomes[0].result === 'rejected' && /R7/.test(co1.outcomes[0].reason ?? ''));
  // CARD-03 的见证字段基线为“已确认”，测量值已有 2762 psi，R7 授权存在 → 应通过
  const co2 = await sync([completeBase(tok('co2'), 7)]);
  check('新版本完成接受', co2.outcomes[0].result === 'accepted');
  check('工卡已完成', getCard(co2.snapshot, 'CARD-03').status === '已完成');

  console.log('8) 阶段签署冲突：先到方不被覆盖');
  const sig1 = await sync([{ token: tok('s1'), kind: 'signature', stage: '动力', value: '高翔', baseValue: '', baseRev: 7, origin: 'A', device: 'dA' }]);
  check('先到签署接受', sig1.outcomes[0].result === 'accepted');
  const sig2 = await sync([{ token: tok('s2'), kind: 'signature', stage: '动力', value: '另一人', baseValue: '', baseRev: 7, origin: 'B', device: 'dB' }]);
  check('后到签署冲突', sig2.outcomes[0].result === 'conflict');
  check('先到签署保留', sig2.snapshot.signatures.find((x) => x.stage === '动力')?.actor === '高翔');

  console.log('9) 写入失败：服务器不接受任何改动，重试同 token 成功（只提交一次）');
  await store.dispatch(maintenanceApi.endpoints.armFailure.initiate()).unwrap();
  let failed = false;
  try {
    await sync([mkField({ token: 'd1', cardId: 'CARD-06', field: 'finding', value: '离线发现X', baseValue: '' })]);
  } catch {
    failed = true;
  }
  check('sync 抛错', failed);
  const srvBeforeRetry = (await store.dispatch(maintenanceApi.endpoints.getWorkPackage.initiate(undefined, { forceRefetch: true })).unwrap());
  check('失败时服务器无改动', getCard(srvBeforeRetry, 'CARD-06').fields.finding.value === '');
  const retry = await sync([mkField({ token: 'd1', cardId: 'CARD-06', field: 'finding', value: '离线发现X', baseValue: '' })]);
  check('同 token 重试接受', retry.outcomes[0].result === 'accepted');
  check('重试值落库', getCard(retry.snapshot, 'CARD-06').fields.finding.value === '离线发现X');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
