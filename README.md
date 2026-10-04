# pair-wise-yy-61 航空器定检工作包执行与放行审阅平台

支持工卡依赖、测量值容差校验、**离线字段级修订合并**、差异处置、分阶段签字、版本差异和放行锁定。超差处理必须与对应工卡版本一起生效，工卡升版后旧授权自动作废。

## 离线修订合并模型

机库内网断开时，所有改动只写本地草稿与待合并队列，网络恢复后逐字段（非整卡）提交服务器做三方合并：

- **逐字段修订与来源**：测量值、发现项、见证确认、阶段签署各自携带修订号、来源（人员/终端）、时间及合并基线值，字段之间互不影响。
- **三方合并**：服务器按 基线值 → 服务器现值 → 本地值 判定：基线一致直接接受；先到方已改则返回冲突并带回先到方的值、修订号与来源，**不覆盖先到数据**。
- **后到方看差异再决定**：差异待决时字段锁定，可“采用先到方 / 保留本方（以先到值为新基线、换新令牌再提交）/ 改用新值”。
- **超差授权绑版本**：授权记录绑定工卡修订号（如 R6）。工卡升版后旧确认立即作废、项目回到待授权，必须在新版本重新授权；放行门禁只认匹配当前版本的授权。
- **旧草稿升级**：无修订号的历史草稿按当前服务器版本补修订号、来源与基线，转为待合并改动，不静默覆盖。
- **失败安全**：写入失败时原草稿与待合并队列原样保留；重试沿用同一改动令牌，服务器按令牌幂等去重，逻辑上只提交一次。

工卡执行页提供“网络/并发演练”入口：模拟对端先改同字段、工卡升版、下一次写入失败。

## 技术栈

React、Fluent UI、Redux Toolkit、React Router、RTK Query（mock 服务器）、Vite、TypeScript。

## 运行

```bash
npm install
npm run dev
```

访问 `http://localhost:62061`。服务器快照、本地草稿、待合并改动和审计均保存在 `localStorage`。

```bash
npm run build
```

合并语义冒烟验证（服务器合并、本地队列、旧草稿迁移共 68 项断言）：

```bash
npx esbuild .smoke/sync.test.ts  --bundle --platform=node --format=cjs --outfile=.smoke/out.cjs     && node .smoke/out.cjs
npx esbuild .smoke/store.test.ts --bundle --platform=node --format=cjs --outfile=.smoke/store.cjs   && node .smoke/store.cjs
npx esbuild .smoke/migrate.test.ts --bundle --platform=node --format=esm --outfile=.smoke/migrate.mjs && node .smoke/migrate.mjs
```
