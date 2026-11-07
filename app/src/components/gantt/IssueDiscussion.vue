<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePmisStore } from '@/stores/pmis'
import { issueActivity } from '@/lib/issueActivity'
const props=defineProps<{issueId:string}>()
const pm=usePmisStore(), draft=ref(''), kind=ref('全部'), search=ref(''), message=ref(''), failed=ref(false)
const activity=computed(()=>issueActivity(pm.state,props.issueId))
const visible=computed(()=>activity.value.filter(a=>(kind.value==='全部'||a.kind===kind.value)&&`${a.actor} ${a.title} ${a.text}`.toLowerCase().includes(search.value.trim().toLowerCase())))
function save(){try{if(!pm.state.issues.some(i=>i.id===props.issueId))throw new Error('找不到議題');pm.comment(`issue:${props.issueId}`,draft.value);failed.value=!!pm.error;message.value=pm.error||'已保存本機留言；未發送通知。';draft.value=''}catch(e){failed.value=true;message.value=e instanceof Error?e.message:'儲存失敗'}}
function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({project:pm.project,issueId:props.issueId,exportedAt:new Date().toISOString(),scope:'本機討論與異動紀錄，非正式簽認',activity:activity.value},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${props.issueId}-activity.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
</script>
<template>
<details class="discussion"><summary>討論與處理歷程（{{activity.length}}）</summary>
 <p class="hint">留言不變更議題狀態，不代表核准或接收方已讀。先在上方填寫操作人姓名，再保存留言。</p>
 <form @submit.prevent="save"><label>議題留言<textarea v-model="draft" required placeholder="記錄協調內容、資料依據與待回覆事項" /></label><button>保存議題留言</button></form>
 <p v-if="message" role="status" :class="{error:failed}">{{message}}</p>
 <div class="filters"><label>歷程類型<select v-model="kind"><option>全部</option><option>留言</option><option>異動</option></select></label><label>搜尋歷程<input v-model="search" placeholder="人員、內容或動作" /></label><button @click="download">匯出完整議題歷程</button></div>
 <p class="hint">顯示 {{Math.min(visible.length,50)}} / {{visible.length}} 筆符合紀錄，最新在前。匯出包含此議題完整歷程。</p>
 <p v-if="!visible.length">沒有符合條件的歷程。</p>
 <ol><li v-for="a in visible.slice(0,50)" :key="a.id"><b>{{a.title}}</b><small>{{a.actor}} · {{new Date(a.at).toLocaleString()}}</small><p>{{a.text||'未附說明'}}</p></li></ol>
</details>
</template>
<style scoped>
.discussion{margin:16px 0;border-top:1px solid var(--line);padding-top:12px;font-size:12px}summary{cursor:pointer;color:#7bd7ff}.hint,small{color:var(--muted)}small{display:block;margin-top:4px}label{display:flex;flex-direction:column;gap:5px;margin:8px 0}textarea,input,select,button{font:inherit;color:var(--text);background:var(--panel-solid);border:1px solid var(--line);border-radius:6px;padding:8px}textarea{min-height:80px;resize:vertical}button{cursor:pointer}.filters{display:flex;flex-wrap:wrap;align-items:end;gap:10px}p{white-space:pre-wrap;overflow-wrap:anywhere}.error{color:#ffa7a7}ol{padding-left:20px}li{padding:12px 4px;border-bottom:1px solid var(--line)}
</style>
