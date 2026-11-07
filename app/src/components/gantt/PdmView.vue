<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { scheduleTrial } from '@/lib/scheduleTrial'
import PdmScenario from './PdmScenario.vue'
import type { PdmLink } from '@/lib/pdmScenario'
import plan from '@/data/assessmentPlan.json'
import { usePmisStore } from '@/stores/pmis'
const pm=usePmisStore()
const emit=defineEmits<{openTask:[code:string]}>()
const basis=ref('WD'), code=ref('1.3'), relation=ref('全部')
const tasks=computed(()=>plan.tasks.filter(t=>t.basis===basis.value))
watch(basis,()=>code.value=tasks.value[0]?.code??'')
const task=computed(()=>tasks.value.find(t=>t.code===code.value))
const scenario=ref<PdmLink[]|null>(null)
const trialRows=computed(()=>scenario.value?scheduleTrial(tasks.value,scenario.value):[])
const edges=computed(()=>(scenario.value??plan.annotatedDependencies).filter(e=>tasks.value.some(t=>t.code===e.source)&&tasks.value.some(t=>t.code===e.target)))
const filtered=computed(()=>edges.value.filter(e=>relation.value==='全部'||e.relation===relation.value))
const before=computed(()=>filtered.value.filter(e=>e.target===code.value))
const after=computed(()=>filtered.value.filter(e=>e.source===code.value))
const unlinked=computed(()=>tasks.value.filter(t=>!edges.value.some(e=>e.source===t.code||e.target===t.code)))
const rows=computed(()=>Math.max(before.value.length,after.value.length,1))
const height=computed(()=>rows.value*105+40)
const centerY=computed(()=>height.value/2)
const name=(id:string)=>plan.tasks.find(t=>t.code===id)?.name??id
const lines=(id:string)=>{const text=name(id);return [text.slice(0,15),text.length>15?text.slice(15,29)+(text.length>29?'…':''):'']}
const y=(index:number)=>65+index*105
function exportData(){const url=URL.createObjectURL(new Blob([JSON.stringify({source:plan.source,basis:basis.value,scope:scenario.value?'未核定試編情境，非完整要徑網圖':'原始明示 FS/SS 關係，非完整要徑網圖',tasks:tasks.value,trialDates:trialRows.value,relations:edges.value},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`pdm-${basis.value}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
</script>
<template><section class="pdm"><header><h2>PDM 前置關係圖</h2><button @click="exportData">匯出關係清冊</button></header><p>選擇工作，檢視直接前置與後續工作；點選左右節點可沿相依關係追蹤。</p><div class="filters"><label>計時範圍<select v-model="basis"><option value="WD">正式評估 WD</option><option value="P">委任前 P</option></select></label><label>焦點工作<select v-model="code"><option v-for="t in tasks" :key="t.code" :value="t.code">{{t.code}} {{t.name}}</option></select></label><label>關係類型<select v-model="relation"><option>全部</option><option>FS</option><option>SS</option><option>FF</option><option>SF</option></select></label></div><p class="notice">FS＝前置完成後，後續才能開始；SS＝前置開始後，後續才能開始。原始視圖呈現文件明示關係；試編視圖使用另存的情境關係。工作日曆與完整邏輯仍待確認；不改寫基準日期；情境只做順推試算，不計算要徑或總浮時。無連線不表示可獨立開工。</p><p class="notice" v-if="scenario">目前顯示未核定試編情境；下方比較表依情境試算，節點工作卡仍保留原文件日期。</p><p>{{tasks.length}} 項工作 · {{edges.length}} 條{{scenario?'情境':'明示'}}關係 · {{unlinked.length}} 項未有明示連線（需確認）。橫向位置僅表示關係方向，不代表時間軸。</p>
<div class="network"><svg :viewBox="`0 0 900 ${height}`" :style="{minHeight:`${height}px`}" role="group" :aria-label="`PDM：${code} 的前置與後續工作`"><defs><marker id="pdm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#62cbff"/></marker></defs>
<g v-for="(edge,index) in before" :key="edge.source"><path :d="`M265 ${y(index)} C310 ${y(index)} 310 ${centerY} 350 ${centerY}`" class="edge" :class="{ss:edge.relation==='SS'}"/><text x="293" :y="y(index)-10">{{edge.relation}}{{'lag' in edge?` +${edge.lag}`:''}}</text><g role="button" tabindex="0" :aria-label="`前置工作 ${edge.source} ${name(edge.source)}`" @click="code=edge.source" @keydown.enter="code=edge.source" @keydown.space.prevent="code=edge.source"><rect x="15" :y="y(index)-40" width="250" height="80" rx="7"/><text x="28" :y="y(index)-20">{{edge.source}} · {{pm.state.work[edge.source]?.status||'未開始'}}</text><text v-for="(line,i) in lines(edge.source)" :key="i" x="28" :y="y(index)+i*18">{{line}}</text><title>{{name(edge.source)}}</title></g></g>
<g v-for="(edge,index) in after" :key="edge.target"><path :d="`M550 ${centerY} C590 ${centerY} 590 ${y(index)} 635 ${y(index)}`" class="edge" :class="{ss:edge.relation==='SS'}"/><text x="590" :y="y(index)-10">{{edge.relation}}{{'lag' in edge?` +${edge.lag}`:''}}</text><g role="button" tabindex="0" :aria-label="`後續工作 ${edge.target} ${name(edge.target)}`" @click="code=edge.target" @keydown.enter="code=edge.target" @keydown.space.prevent="code=edge.target"><rect x="635" :y="y(index)-40" width="250" height="80" rx="7"/><text x="648" :y="y(index)-20">{{edge.target}} · {{pm.state.work[edge.target]?.status||'未開始'}}</text><text v-for="(line,i) in lines(edge.target)" :key="i" x="648" :y="y(index)+i*18">{{line}}</text><title>{{name(edge.target)}}</title></g></g>
<g><rect class="focus" x="350" :y="centerY-42" width="200" height="84" rx="7"/><text x="362" :y="centerY-21">焦點 {{code}}</text><text v-for="(line,i) in lines(code)" :key="i" x="362" :y="centerY+i*18">{{line}}</text></g></svg></div>
<p v-if="!before.length&&!after.length">目前關係篩選下沒有直接連線，請切換工作或關係類型；不可據此判定無前置限制。</p>
<article v-if="task"><h3>{{task.code}} · {{task.name}}</h3><p>{{basis}}{{task.start}}–{{task.end}} · {{task.end-task.start+1}} 工作日 · {{task.owner}}</p><p>目前狀態：{{pm.state.work[task.code]?.status||'未開始'}}</p><button @click="emit('openTask',task.code)">工作詳情／3D 關聯</button></article>
<details><summary>{{scenario?'試編情境':'完整明示'}}關係清冊（{{edges.length}}）</summary><table><thead><tr><th>前置</th><th>類型</th><th>後續</th></tr></thead><tbody><tr v-for="e in edges" :key="`${e.source}:${e.target}`"><td><button @click="code=e.source">{{e.source}} {{name(e.source)}}</button></td><td>{{e.relation}}</td><td><button @click="code=e.target">{{e.target}} {{name(e.target)}}</button></td></tr></tbody></table></details><details><summary>未有明示連線工作（{{unlinked.length}}）</summary><button class="unlinked" v-for="t in unlinked" :key="t.code" @click="code=t.code">{{t.code}} {{t.name}}</button></details>
<article v-if="scenario"><h3>情境日期試算與 3D 對應</h3><p>保留原工期與原起日下限；FS 採次工作日起算，延遲使用工作日序號。只依目前關係順推，不含資源限制、日曆或要徑。情境中 {{trialRows.filter(t=>t.shift>0).length}} 項延後。</p><table><thead><tr><th>工作</th><th>原日期 → 試算日期</th><th>延後</th><th>模型</th></tr></thead><tbody><tr v-for="t in trialRows.filter(t=>t.shift>0)" :key="t.code"><td>{{t.code}} {{t.name}}</td><td>{{t.baselineStart}}–{{t.baselineEnd}} → {{t.start}}–{{t.end}}</td><td>{{t.shift}} 工作日</td><td><button @click="emit('openTask',t.code)">詳情／3D</button></td></tr></tbody></table><p v-if="!trialRows.some(t=>t.shift>0)">此情境未使工作晚於原日期。</p></article><PdmScenario :basis="basis" @preview="value=>scenario=value" /><p class="notice">後續正式排程規劃：建立可核定的關係與延遲量、工作日曆及 T0，再進行循環檢查、CPM 要徑／浮時試算、基準版與變更比較。現階段先供關係盤點與團隊確認。</p>
</section></template>
<style scoped>
.pdm{padding:20px;color:var(--text);font-size:12px;line-height:1.7}header,.filters{display:flex;flex-wrap:wrap;gap:12px;align-items:center}header{justify-content:space-between}h2{font-size:20px}label{display:flex;flex-direction:column;gap:5px;max-width:100%}button,select{font:inherit;color:var(--text);background:var(--panel-solid);border:1px solid var(--line);padding:8px;border-radius:6px;max-width:100%}button,summary{cursor:pointer}.notice{padding:12px;border-left:2px solid #e6b666;background:#e6b66612;color:#e6c88e}.network{overflow:auto;border:1px solid var(--line);border-radius:8px;max-height:600px}svg{width:100%;min-width:900px;display:block}svg text{fill:var(--text);font-size:12px}rect{fill:var(--panel-solid);stroke:#467791}.focus{stroke:#ffbb66;fill:#57482a}.edge{fill:none;stroke:#62cbff;stroke-width:2;marker-end:url(#pdm-arrow)}.ss{stroke-dasharray:5 4}g[role=button]{cursor:pointer}g[role=button]:focus rect,g[role=button]:hover rect{stroke:#ffbb66;stroke-width:3}article{padding:12px;border:1px solid var(--line);margin:16px 0}details{margin:18px 0}summary{color:#7bd7ff}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:left}.unlinked{display:block;margin:6px 0;width:100%;text-align:left}
</style>
