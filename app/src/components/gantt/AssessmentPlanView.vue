<script setup lang="ts">
import { DEMO_PROJECT_ID, installMockDemo } from '@/data/mockDemo'
import { computed, ref, watch } from 'vue'
import PdmView from './PdmView.vue'
import ProgressCurvesView from './ProgressCurvesView.vue'
import DeliveryView from './DeliveryView.vue'
import InspectionsView from './InspectionsView.vue'
import MeetingsView from './MeetingsView.vue'
import PmisWorkspace from './PmisWorkspace.vue'
import { usePmisStore } from '@/stores/pmis'
import plan from '@/data/assessmentPlan.json'
import { PARTS } from '@/data/parts'
import { useViewerStore } from '@/stores/viewer'
const props=defineProps<{projectId:string;initialView?:string}>()
const presentationMode = import.meta.env.DEV && new URLSearchParams(location.search).get('presentation') === '1'
const pm=usePmisStore()
watch(()=>props.projectId,id=>pm.load(id),{immediate:true})
const detail=ref<{mode:string;target:string}|null>(null)
function resetDemo(){try{installMockDemo(new URL(import.meta.env.BASE_URL, document.baseURI).href,true);pm.load(props.projectId)}catch{alert('示範資料儲存失敗，請先匯出備份。')}}
function openDetail(mode:string,target:string){ detail.value={mode,target} }
const viewer=useViewerStore(), tab=ref('home'), basis=ref('WD'), query=ref('')
const rows=computed(()=>plan.tasks.filter(t=>t.basis===basis.value&&(workStatus.value==='全部'||(pm.state.work[t.code]?.status??'未開始')===workStatus.value)&&JSON.stringify(t).toLowerCase().includes(query.value.toLowerCase())))
const workStatus=ref('全部')
const docs=computed(()=>plan.documents.filter(d=>JSON.stringify(d).toLowerCase().includes(query.value.toLowerCase())))
const maxDay=computed(()=>basis.value==='P'?35:80)
const tabs=[['home','角色工作台'],['curves','S 曲線／燃盡圖'],['delivery','交付與驗收總覽'],['issues','議題協調'],['meetings','會議與決策'],['inspections','查驗與缺失'],['wbs','WBS 工作內容'],['gantt','工作日甘特圖'],['pdm','PDM 關係圖'],['documents','交付文件'],['mapping','3D 評估對應'],['gates','節點與權責']]
watch(() => props.initialView, view => {
  if (view && tabs.some(([key]) => key === view)) {
    detail.value = null
    tab.value = view
  }
}, { immediate: true })
const selectedCode = ref<string | null>(null)
const selectedTask = computed(() => plan.tasks.find(t => t.code === selectedCode.value))
function related(id:string){return plan.tasks.filter(t=>pm.taskParts(t.code).includes(id)).map(t=>t.code).join('、')||'未關聯'}
function taskParts(code:string){return PARTS.filter(p=>pm.taskParts(code).includes(p.id))}
const selectedParts = computed(() => selectedCode.value ? taskParts(selectedCode.value) : [])
watch(selectedParts,parts=>{if(selectedCode.value){viewer.isolatedId=null;viewer.highlightedIds=new Set(parts.map(p=>p.id))}})
function clearSelection() {
  selectedCode.value = null
  viewer.showAll()
  viewer.highlightedIds = new Set()
  viewer.progressFilter = null
  viewer.progressFilterSuppressed = true
  viewer.unlockCamera()
}
function selectTask(code: string) {
  clearSelection()
  selectedCode.value = code
  const parts = taskParts(code)
  viewer.highlightedIds = new Set(parts.map(p => p.id))
  if (parts[0]) viewer.requestFreeFocus(parts[0].id)
}
function focus(id: string) {
  viewer.showAll()
  viewer.progressFilter = null
  viewer.progressFilterSuppressed = true
  viewer.highlightedIds = new Set([id])
  viewer.isolatedId = id
  viewer.requestFreeFocus(id)
}
function highlightTasks(codes:string[]){viewer.showAll();viewer.isolatedId=null;viewer.progressFilter=null;viewer.progressFilterSuppressed=true;selectedCode.value=null;viewer.highlightedIds=new Set(codes.flatMap(code=>pm.taskParts(code)));viewer.unlockCamera()}
function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='PacificPower-PISG-Rev1.3-H4.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
</script>
<template>
<section class="assessment">
<div class="plan-content" :inert="!!detail"><header><small>工作範圍依據 · {{plan.source.revision}} · {{plan.source.date}}</small><h2>資料中心前期策略與技術方向評估</h2><button @click="download">下載工作清冊 JSON</button></header>
<p v-if="projectId===DEMO_PROJECT_ID && !presentationMode" class="notice"><b>MOCK DATA｜示範專案</b> · 模擬基準日 2026-11-07；非真實工程進度。<button @click="resetDemo">重置示範資料（保留前次副本）</button></p>
<p class="notice">園區總容量調整為 <b>50 MW</b>，與評估文件容量一致。既有 3D 佈局供需求評估參照，設備配置與 IT 容量待核定，不代表已核定設計或已完成施工。</p>
<nav><button v-for="item in tabs" :key="item[0]" :class="{active:tab===item[0]}" @click="tab=item[0]!">{{item[1]}}</button></nav>
<nav v-if="['gantt','pdm','curves'].includes(tab)" aria-label="時程視圖切換"><button @click="tab='gantt'">甘特圖 · 工作日安排</button><button @click="tab='pdm'">PDM · 前置關係</button><button @click="tab='curves'">S 曲線／燃盡圖 · 進度追蹤</button></nav><div class="tools"><select v-if="['wbs','gantt'].includes(tab)" v-model="workStatus" aria-label="工項狀態篩選"><option v-for="s in ['全部','未開始','執行中','待審查','已接受','退回修訂']" :key="s">{{s}}</option></select><template v-if="tab==='wbs'||tab==='gantt'"><button :class="{active:basis==='P'}" @click="basis='P'">委任前 P1–35</button><button :class="{active:basis==='WD'}" @click="basis='WD'">正式評估 WD1–80</button></template><input v-if="['wbs','gantt','documents'].includes(tab)" v-model="query" aria-label="搜尋工作或文件" placeholder="搜尋 WBS、文件、主責…" /></div>
<div v-if="selectedTask && (tab==='wbs'||tab==='gantt')" class="selection" aria-live="polite">
  <b>{{selectedTask.code}} · {{selectedTask.name}}</b>
  <template v-if="selectedParts.length"><small>已標示 {{selectedParts.length}} 組相關元件；點選下方元件可單獨定位。此為評估參照，不表示施工完成。</small><div class="part-links"><button v-for="p in selectedParts" :key="p.id" @click="focus(p.id)">{{p.name}}</button></div></template>
  <small v-else>此項為文件、管理或審查節點，目前未對應實體 3D 元件。</small>
  <button @click="openDetail('task',selectedTask.code)">工作詳情／協作</button><button @click="clearSelection">清除選取／顯示全部</button>
</div>
<div class="body">
<PmisWorkspace @open-inspections="tab='inspections'" v-if="tab==='home'||tab==='issues'" :mode="tab" @open-task="code=>{selectTask(code);openDetail('task',code)}" @open-document="code=>openDetail('document',code)" @open-asset="id=>{focus(id);openDetail('asset',id)}" />
<PdmView v-else-if="tab==='pdm'" @open-task="code=>{selectTask(code);openDetail('task',code)}" />
<ProgressCurvesView @highlight-tasks="highlightTasks" v-else-if="tab==='curves'" @open-task="code=>{selectTask(code);openDetail('task',code)}" />
<DeliveryView @open-issue="id=>openDetail('issue',id)" v-else-if="tab==='delivery'" @open-task="code=>{selectTask(code);openDetail('task',code)}" @open-document="code=>openDetail('document',code)" @open-asset="id=>{focus(id);openDetail('asset',id)}" @navigate="target=>tab=target" />
<InspectionsView v-else-if="tab==='inspections'" @open-task="code=>{selectTask(code);openDetail('task',code)}" @open-document="code=>openDetail('document',code)" @open-asset="id=>{focus(id);openDetail('asset',id)}" @open-issues="tab='issues'" />
<MeetingsView v-else-if="tab==='meetings'" @open-task="code=>{selectTask(code);openDetail('task',code)}" @open-document="code=>openDetail('document',code)" @open-asset="id=>{focus(id);openDetail('asset',id)}" @open-issues="tab='issues'" />
<template v-else-if="tab==='wbs'||tab==='gantt'"><p>50 項末階工作／審查／節點。每週 5 工作日；P 與 WD 分開計時。T0 待確認，不換算日曆日期；此為來源草案基準，非實際進度。</p>
<table><thead><tr><th>WBS</th><th>工作／審查與主責</th><th>{{basis}} 起–迄</th><th>日數</th><th>{{tab==='gantt'?`${basis}1 → ${basis}${maxDay}（每格5工作日）`:'交付／來源'}}</th></tr></thead><tbody><tr v-for="t in rows" :key="t.code" :class="{selected:selectedCode===t.code}" @click="selectTask(t.code)"><td>{{t.code}}</td><td><button class="task-link" :aria-pressed="selectedCode===t.code" @click.stop="selectTask(t.code)">{{t.name}}</button><small>{{taskParts(t.code).length ? `3D 關聯：${taskParts(t.code).length} 組元件` : '無實體元件對應'}}</small><small>{{t.owner}} · {{pm.state.work[t.code]?.status??'未開始'}}</small><button @click.stop="openDetail('task',t.code)">管理工作</button><small>{{plan.annotatedDependencies.filter(e=>e.target===t.code).map(e=>`${e.relation} ← ${e.source}`).join(' · ')}}</small></td><td>{{t.start}}–{{t.end}}</td><td>{{t.end-t.start+1}}</td><td v-if="tab==='gantt'"><div class="track" :style="{backgroundSize:`${500/maxDay}% 100%`}"><button :aria-label="`選取工項 ${t.code} 並查看 3D 關聯`" @click.stop="selectTask(t.code)" :class="{milestone:t.start===t.end,buffer:t.code==='3.6'||t.code==='0.2'}" :style="{left:`${(t.start-1)/maxDay*100}%`,width:`${(t.end-t.start+1)/maxDay*100}%`}" :title="`${t.name}：${basis}${t.start}–${t.end}`" /></div></td><td v-else>{{t.documents.join('、')||'—'}}<small>來源第 {{t.page}} 頁</small></td></tr></tbody></table><p>FS／SS 僅轉錄原表明示的跨項標註，非完整可運算網圖。同日 G0／K2 在修訂完成後確認，不額外推移一天。</p></template>
<template v-else-if="tab==='documents'"><p>5 份商務文件＋16 份基本交付＋4 份另行選配。此處為交付要求清冊，文件尚未編製或驗收。</p><table><thead><tr><th>編號／交付</th><th>工作內容與主責</th><th>時點／格式</th></tr></thead><tbody><tr v-for="d in docs" :key="d.code"><td><button @click="openDetail('document',d.code)">{{d.code}} · 版本／審查</button><b>{{d.name}}</b><small>{{d.optional?'選配｜不納基本範圍與驗收':'基本範圍'}} · 來源第8頁</small></td><td>{{d.scope}}<small>{{d.owner}}</small></td><td>{{d.due}}<small>{{d.format}}</small></td></tr></tbody></table></template>
<template v-else-if="tab==='mapping'"><p>此為本專案新增的評估參照關聯，不是 PDF 的構件施工綁定。文件完成不代表設備已安裝，管線與設備細節待後續設計確認。</p><table><thead><tr><th>3D 群組</th><th>參照 WBS</th><th>操作</th></tr></thead><tbody><tr v-for="p in PARTS" :key="p.id"><td>{{p.name}}</td><td>{{related(p.id)}}</td><td><button @click="focus(p.id)">定位模型</button><button @click="openDetail('asset',p.id)">資料卡／議題</button></td></tr></tbody></table><button @click="clearSelection">顯示全部模型</button></template>
<template v-else><h3>節點追蹤與決策紀錄</h3><p>開啟節點工作可設定負責人、建立待決議題與記錄審查說明；本機狀態不代表正式啟動授權。</p><button v-for="code in ['1.3','2.4.2','2.5.2','2.6.2','3.1.2','3.3.2','3.4.2','3.5.4','3.7']" :key="code" @click="openDetail('task',code)">{{plan.tasks.find(t=>t.code===code)?.name.split(' ').slice(0,2).join(' ')}} · {{pm.state.work[code]?.status??'未開始'}}</button><h3>啟動與接受條件</h3><ul><li>C0 詢價基準書面確認；C1 主約／分包差異核定；C2 兩約簽署完成。</li><li>R0 確認資料入口、具名人員與生效條件；T0 以正式通知為準。P31–35 緩衝動用時更新 T0。</li><li>G0 WD12：階段 A 驗收及完整啟動／限縮／暫停決策。階段 B 須 G0 核定且主約、分包生效；補件、共識與議約等待另排。</li><li>K1 WD23 → D1 WD35 → G1 WD40 → 修訂及兩約接受／K2 WD43 → K3 WD57 → D2 WD62 → QA WD73–74 → F WD75。</li><li>G1 未達共識時，受影響工作與時程另議。G2 為實際 F 後的後續行動／暫緩決策，基準 WD76–78。</li><li>WD76–80 為獨立緩衝，與 G2 重疊，不相加成 WD83。</li></ul><h3>分工與提交</h3><p>太電有權人負責階段決策、主約驗收與核款；太電 PMO 彙整資料與一次合併審查。PISG 負責商務、合約、進度、正式提交及收付款，文件未配置 PISG 技術團隊。HPE 主顧問整合技術與統一回覆，各專業編製並由適任人員獨立複核。正式提交經 PISG；主約由太電、分包由 PISG 依各自授權辦理。</p><h3>範圍與待確認</h3><p>來源為討論草案，不是已簽署合約。DOC-07 不含詳細負載表、配電設計及設備選型；DOC-17～20 另行委任、排程及驗收。Blender／GLB 模型尚不能作為施工放樣、碰撞驗證或竣工依據。待確認容量口徑、基地、人員授權、T0、資料充分性及正式工作範圍。</p></template>
<footer>{{plan.source.title}} · {{plan.source.revision}} · {{plan.source.status}}<br/>UUID {{plan.source.uuid}} · 工作名稱略作縮寫，原始 WBS 編號與工作日保留。</footer>
</div>
</div>
<div v-if="detail" class="detail-overlay" role="region" aria-label="PMIS 協作詳情" @keydown.esc="detail=null"><div class="detail-head"><b>協作詳情 · {{detail.target}}</b><button @click="detail=null" aria-label="關閉協作詳情">關閉 ×</button></div><PmisWorkspace @open-inspections="detail=null;tab='inspections'" :key="`${detail.mode}:${detail.target}`" :mode="detail.mode" :target="detail.target" @open-task="code=>{selectTask(code);openDetail('task',code)}" @open-document="code=>openDetail('document',code)" @open-asset="id=>{focus(id);openDetail('asset',id)}" /></div>
</section>
</template>
<style scoped>
.plan-content{display:flex;flex-direction:column;flex:1;min-height:0}.assessment{position:relative}.detail-overlay{position:absolute;inset:0;background:var(--panel-solid);z-index:20;display:flex;flex-direction:column;min-height:0}.detail-head{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line)}.detail-overlay :deep(.pmis){flex:1;min-height:0}

.selection{padding:10px 20px;background:#ff681b12;border-bottom:1px solid var(--line);max-height:190px;overflow:auto;flex-shrink:0}.part-links{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}.part-links button{font-size:11px;padding:4px 7px}.task-link{text-align:left;padding:0;border:0;font-weight:500;line-height:1.6}.selected{background:#ff681b20}tbody tr:hover{background:#ff681b0d}button:focus-visible{outline:2px solid #ffad7a;outline-offset:3px}

.assessment{height:100%;display:flex;flex-direction:column;background:var(--panel-solid);color:var(--text);font-size:12px;min-width:0;min-height:0}header{padding:12px 20px}h2{font-size:18px;margin:5px 0 10px}small{display:block;color:var(--muted);font-size:11px;margin-top:5px}button,input,select{border:1px solid var(--line);border-radius:5px;padding:7px 10px;background:transparent;color:inherit}button{cursor:pointer}button:hover,.active{background:#ff681b20;border-color:#ff681b;color:#ffad7a}.notice{margin:0;padding:10px 20px;background:#d99b1618;color:#eac887;line-height:1.7}nav,.tools{display:flex;gap:8px;padding:10px 20px;flex-wrap:wrap;border-bottom:1px solid var(--line)}input{margin-left:auto;min-width:180px}.body{overflow:auto;padding:0 20px 20px;flex:1;min-height:0}p,li{line-height:1.8}table{border-collapse:collapse;width:100%;min-width:640px}th,td{text-align:left;padding:10px 9px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:11px;white-space:nowrap}td:first-child{min-width:64px}td b{display:block;font-weight:500}.track{width:260px;height:25px;position:relative;background-image:linear-gradient(to right,#ffffff20 1px,transparent 1px)}.track button{padding:0;border:0;position:absolute;top:5px;height:15px;background:#ff681b;border-radius:2px;min-width:3px}.track .milestone{background:#edab61}.track .buffer{background:#8597a1}footer{color:var(--muted);padding-top:24px;line-height:1.7}h3{margin-top:24px}
</style>
