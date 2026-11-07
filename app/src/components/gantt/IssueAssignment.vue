<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePmisStore, type Issue } from '@/stores/pmis'
const props=defineProps<{issue:Issue}>()
const pm=usePmisStore(), editing=ref(false), owner=ref(''), due=ref(''), priority=ref('一般'), reason=ref(''), message=ref(''), failed=ref(false)
const history=computed(()=>pm.state.audit.filter(a=>a.target===props.issue.id&&a.action==='議題責任與期限調整'))
function start(){owner.value=props.issue.owner;due.value=props.issue.due;priority.value=props.issue.priority;reason.value='';message.value='';editing.value=true}
function save(){try{pm.updateIssueAssignment(props.issue.id,{owner:owner.value,due:due.value,priority:priority.value},reason.value);failed.value=!!pm.error;message.value=pm.error||'已保存責任與期限調整；未發送通知。';editing.value=false}catch(e){failed.value=true;message.value=e instanceof Error?e.message:'儲存失敗'}}
</script>
<template>
<section class="assignment">
 <button v-if="!editing" :disabled="issue.status==='已結案'" @click="start">調整責任／期限</button>
 <small v-if="issue.status==='已結案'">已結案；須先重新處理才能調整。</small>
 <form v-if="editing" @submit.prevent="save">
  <h4>責任移交與期限調整</h4>
  <p>目前：{{issue.owner}} · {{issue.due||'未設定期限'}} · {{issue.priority}}</p>
  <div class="fields"><label>新責任窗口<input v-model="owner" required /></label><label>新回覆期限<input v-model="due" type="date" /></label><label>新優先級<select v-model="priority"><option>一般</option><option>高</option><option>緊急</option></select></label></div>
  <label>變更原因<textarea v-model="reason" required placeholder="說明移交、展延或清除期限的原因與協調依據" /></label>
  <p class="hint">清空日期代表未設定期限。此操作保留議題狀態與處理回覆，不代表接收方同意或正式展延核准。</p>
  <button type="submit">儲存調整</button><button type="button" @click="editing=false">取消</button>
 </form>
 <p v-if="message" role="status" :class="{error:failed}">{{message}}</p>
 <details v-if="history.length"><summary>責任／期限異動紀錄（{{history.length}}）</summary><article v-for="a in history" :key="a.id"><b>{{a.actor}} · {{new Date(a.at).toLocaleString()}}</b><p>{{a.note}}</p></article></details>
</section>
</template>
<style scoped>
.assignment{margin:14px 0;border-top:1px solid var(--line);padding-top:10px}.fields{display:flex;flex-wrap:wrap;gap:12px}label{display:flex;flex-direction:column;gap:5px;margin:8px 0}input,select,textarea,button{font:inherit;color:var(--text);background:var(--panel-solid);border:1px solid var(--line);border-radius:6px;padding:8px}button{cursor:pointer;margin-right:8px}button:disabled{opacity:.5;cursor:not-allowed}textarea{min-height:70px;resize:vertical}.hint,small{color:var(--muted)}p{white-space:pre-wrap;overflow-wrap:anywhere}.error{color:#ffa7a7}summary{cursor:pointer;color:#ffad7a}article{border-bottom:1px solid var(--line);padding:10px}h4{margin:10px 0}form{padding:12px;background:#ff681b08}
</style>
