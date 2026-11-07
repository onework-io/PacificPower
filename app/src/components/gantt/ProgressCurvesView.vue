<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { usePmisStore } from '@/stores/pmis'
import { PARTS } from '@/data/parts'
import plan from '@/data/assessmentPlan.json'
import { scheduleTrial } from '@/lib/scheduleTrial'
import type { PdmLink } from '@/lib/pdmScenario'
import { progressCurves } from '@/lib/progressCurves'
const pm=usePmisStore()
const emit=defineEmits<{openTask:[code:string];highlightTasks:[codes:string[]]}>()
const basis=ref<'P'|'WD'>('WD'), asset=ref(''), reportDay=ref<number|null>(null)
watch(basis,()=>reportDay.value=null)
const trial=ref(false), trialLinks=ref<PdmLink[]|null>(null), trialError=ref('')
function loadTrial(){trialError.value='';trialLinks.value=null;try{const raw=localStorage.getItem(`pacificpower-pdm-scenario-v1:${pm.project}:${basis.value}`);if(!raw)throw new Error('此範圍尚無已保存的 PDM 情境');const data=JSON.parse(raw);if(data.schema!==1||!Array.isArray(data.links))throw new Error('情境格式不正確');scheduleTrial(plan.tasks.filter(t=>t.basis===basis.value),data.links);trialLinks.value=data.links}catch(e){trial.value=false;trialError.value=e instanceof Error?e.message:'讀取失敗'}}
watch(()=>[basis.value,pm.project],()=>{trial.value=false;loadTrial()},{immediate:true})
const trialRows=computed(()=>trial.value&&trialLinks.value?scheduleTrial(plan.tasks.filter(t=>t.basis===basis.value),trialLinks.value):undefined)
const curve=computed(()=>progressCurves(pm.state,basis.value,asset.value,trialRows.value))
const baseline=computed(()=>progressCurves(pm.state,basis.value,asset.value))
const baseS=computed(()=>baseline.value.points.map((p,i)=>`${i?'L':'M'}${x(p.day)},${y(p.percent,100)}`).join(' '))
const baseBurn=computed(()=>baseline.value.points.map((p,i)=>`${i?'L':'M'}${x(p.day)},${y(p.remaining,curve.value.total)}`).join(' '))
const previewPhase=ref('')
watch(()=>[reportDay.value,curve.value],()=>{if(previewPhase.value){if(validDay.value)highlight(previewPhase.value);else emit('highlightTasks',[])}})
onUnmounted(()=>emit('highlightTasks',[]))
function clearHighlight(){previewPhase.value='';emit('highlightTasks',[])}
function highlight(phase:string){if(!validDay.value)return;previewPhase.value=phase;const day=reportDay.value!;emit('highlightTasks',curve.value.tasks.filter(t=>phase==='active'?t.start<=day&&t.end>day:phase==='completed'?t.end<=day:t.start>day).map(t=>t.code))}

const validDay=computed(()=>typeof reportDay.value==='number'&&Number.isInteger(reportDay.value)&&reportDay.value>=0&&reportDay.value<=curve.value.days)
const selected=computed(()=>validDay.value?curve.value.points[reportDay.value!]:undefined)
const x=(day:number)=>48+day/curve.value.days*590
const y=(value:number,max:number)=>210-value/Math.max(max,1)*180
const sPath=computed(()=>curve.value.points.map((p,i)=>`${i?'L':'M'}${x(p.day)},${y(p.percent,100)}`).join(' '))
const burnPath=computed(()=>curve.value.points.map((p,i)=>`${i?'L':'M'}${x(p.day)},${y(p.remaining,curve.value.total)}`).join(' '))
const gap=computed(()=>selected.value?curve.value.accepted-selected.value.completed:0)
function exportData(){const data={project:pm.project,generatedAt:new Date().toISOString(),basis:basis.value,asset:asset.value,reportDay:validDay.value?reportDay.value:null,scheduleMode:trialRows.value?'未核定 PDM 情境試算':'原文件基準',method:'等權項目；計畫按結束日完成，排除緩衝；目前已接受狀態非歷史實績',...curve.value};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`progress-${basis.value}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
</script>
<template>
<section class="curves"><header><h2>S 曲線與燃盡圖</h2><button @click="exportData">匯出曲線與目前狀態</button></header>
<p>以 WBS 工作／審查／決策項目等權追蹤，非工程量、成本或實體施工完成率。</p>
<div class="filters"><label>計時範圍<select v-model="basis"><option value="WD">WD · 正式評估 80 工作日</option><option value="P">P · 委任前 35 工作日</option></select></label><label>模型關聯範圍<select v-model="asset"><option value="">全部項目</option><option v-for="p in PARTS" :key="p.id" :value="p.id">{{p.name}}</option></select></label><label>比較工作日（手動選擇）<input type="number" min="0" :max="curve.days" step="1" v-model.number="reportDay" placeholder="尚未指定" /></label></div>
<div class="filters"><label><input type="checkbox" v-model="trial" :disabled="!trialLinks" />使用已保存 PDM 情境試算</label><button @click="loadTrial">重新讀取情境</button><span>{{trialError}}</span></div><p v-if="trialRows" class="notice">情境試算：原起日為最早限制、維持原工期、FS 後續最早次工作日；不含假日或資源限制。灰虛線為原基準，橘線為情境。試算終點 {{basis}}{{curve.days}}，原範圍 {{basis}}{{baseline.days}}。</p><p class="notice">T0 尚未設定，不推算今天是第幾工作日。計畫依原 WBS 結束日累計；0.2 與 3.6 緩衝不計入。已接受項目才算完成，執行中／待審查不給推估百分比。目前狀態點僅供與指定工作日比較，不代表該日歷史實績。</p>
<p v-if="reportDay!==null&&String(reportDay)!==''&&!validDay" class="notice">請填寫 0～{{curve.days}} 的整數工作日。</p>
<div class="metrics"><article><b>{{curve.total}}</b>納入項目</article><article><b>{{curve.accepted}} / {{curve.total}}</b>目前已接受</article><article><b>{{curve.remaining}}</b>目前未接受</article><article><b>{{selected?(gap>0?'+':'')+gap:'—'}}</b>相對所選工作日差異（項）</article></div>
<p v-if="!curve.total" class="notice">此模型與計時範圍沒有關聯項目，無法計算曲線；不代表完成。</p>
<template v-else><div class="filters"><b>3D 工作日預覽</b><button :disabled="!validDay" @click="highlight('active')">標示計畫執行中元件</button><button :disabled="!validDay" @click="highlight('completed')">標示計畫已結束元件</button><button :disabled="!validDay" @click="highlight('future')">標示計畫未開始元件</button><button @click="clearHighlight">清除模型標示</button></div><p v-if="previewPhase&&validDay">目前 3D：{{basis}}{{reportDay}} · {{previewPhase==='active'?'計畫執行中':previewPhase==='completed'?'計畫已結束':'計畫未開始'}}；變更工作日或範圍時同步更新。</p><p>3D 標示以所選工作日日終為比較點，表示評估工作的元件關聯；不表示設備已施工。同一群組可關聯多項不同階段工作。</p>
<div class="charts"><article class="chart"><h3>S 曲線 · 累計完成項目比例</h3><p>橘線：計畫累計；藍點：目前已接受比例 {{curve.percent.toFixed(1)}}%（需指定比較工作日）。</p><svg viewBox="0 0 680 255" role="img" aria-label="S 曲線：計畫累計完成比例與目前已接受比例"><g v-for="tick in [0,25,50,75,100]" :key="tick"><line x1="48" x2="638" :y1="y(tick,100)" :y2="y(tick,100)" class="grid"/><text x="3" :y="y(tick,100)+4">{{tick}}%</text></g><path v-if="trialRows" :d="baseS" class="baseline"/><path :d="sPath" class="planned"/><circle v-if="validDay" :cx="x(reportDay!)" :cy="y(curve.percent,100)" r="6" class="actual"><title>目前已接受 {{curve.percent.toFixed(1)}}%</title></circle><text v-for="day in [0,Math.floor(curve.days/2),curve.days]" :key="day" :x="x(day)" y="238" text-anchor="middle">{{basis}}{{day}}</text></svg></article>
<article class="chart"><h3>Burn-down chart · 剩餘項目</h3><p>橘線：計畫剩餘；藍點：目前未接受 {{curve.remaining}} 項。退回修訂後會重新計入未完成。</p><svg viewBox="0 0 680 255" role="img" aria-label="燃盡圖：計畫剩餘項目與目前未接受項目"><g v-for="tick in [...new Set([0,Math.ceil(curve.total/2),curve.total])]" :key="tick"><line x1="48" x2="638" :y1="y(tick,curve.total)" :y2="y(tick,curve.total)" class="grid"/><text x="8" :y="y(tick,curve.total)+4">{{tick}}</text></g><path v-if="trialRows" :d="baseBurn" class="baseline"/><path :d="burnPath" class="planned"/><circle v-if="validDay" :cx="x(reportDay!)" :cy="y(curve.remaining,curve.total)" r="6" class="actual"><title>目前未接受 {{curve.remaining}} 項</title></circle><text v-for="day in [0,Math.floor(curve.days/2),curve.days]" :key="day" :x="x(day)" y="238" text-anchor="middle">{{basis}}{{day}}</text></svg></article>
</div><p v-if="!validDay" class="notice">選擇比較工作日後顯示目前狀態點。尚無逐日進度快照，因此不繪製實際歷史連線。</p>
<details><summary>逐日計畫數據</summary><div class="table"><table><thead><tr><th>工作日</th><th>累計完成</th><th>累計比例</th><th>剩餘項目</th></tr></thead><tbody><tr v-for="p in curve.points" :key="p.day"><td>{{basis}}{{p.day}}</td><td>{{p.completed}}</td><td>{{p.percent.toFixed(1)}}%</td><td>{{p.remaining}}</td></tr></tbody></table></div></details>
<h3>{{selected?`計畫於 ${basis}${reportDay} 前完成、目前尚未接受`:'目前尚未接受項目'}}</h3><p>以下清單使用目前狀態核對，點選可查看工作詳情與 3D 關聯。</p><button class="task" v-for="t in curve.tasks.filter(t=>pm.state.work[t.code]?.status!=='已接受'&&(!selected||t.end<=reportDay!))" :key="t.code" @click="emit('openTask',t.code)">{{t.code}} · {{t.name}}<small>計畫完成 {{basis}}{{t.end}} · {{pm.state.work[t.code]?.status||'未開始'}}</small></button>
</template><footer>此為評估草案的管理追蹤視圖。成本／工時加權、核定基準版及逐期實際進度需另行建立；不提供虛構的 SPI、預測完工日或歷史曲線。</footer>
</section>
</template>
<style scoped>
.curves{padding:20px;font-size:12px;color:var(--text);line-height:1.7}header,.filters{display:flex;flex-wrap:wrap;align-items:center;gap:12px}header{justify-content:space-between}h2{font-size:20px}label{display:flex;flex-direction:column;gap:5px}button,input,select{font:inherit;color:var(--text);background:var(--panel-solid);border:1px solid var(--line);border-radius:6px;padding:8px;max-width:100%}button,summary{cursor:pointer}.notice{padding:12px;border-left:2px solid #e6b666;background:#e6b66612;color:#e6c88e}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metrics b{display:block;color:#ffad7a;font-size:24px}article{border:1px solid var(--line);border-radius:8px;padding:12px;margin:14px 0}.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}svg{width:100%;display:block;overflow:visible}svg text{font-size:12px;fill:var(--muted)}.grid{stroke:var(--line)}.baseline{fill:none;stroke:#acb9bf;stroke-width:2;stroke-dasharray:6 4}.planned{fill:none;stroke:#ffad7a;stroke-width:2.5}.actual{fill:#6bbaff;stroke:#fff;stroke-width:1.5}small,footer{display:block;color:var(--muted)}.task{display:block;text-align:left;width:100%;margin:8px 0}.table{max-height:300px;overflow:auto}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid var(--line)}summary{color:#ffad7a}footer{margin-top:20px}@media(max-width:700px){.metrics{grid-template-columns:1fr 1fr}}
</style>
