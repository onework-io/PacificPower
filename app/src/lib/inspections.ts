export interface InspectionItem { id:string; label:string; result:'未查驗'|'合格'|'不合格'|'不適用'; note:string; issueId:string }
export interface Inspection { id:string; title:string; date:string; inspector:string; reviewer:string; asset:string; task:string; document:string; basis:string; evidence:string; items:InspectionItem[]; status:'草稿'|'待複核'|'已接受'|'退回'; reviewNote:string; submittedBy:string; reviewedBy:string }
export const inspectionTemplates:Record<string,string[]>={
 '資料完整性':['確認資料來源及版本','確認容量口徑與假設','確認待決事項與責任窗口','確認交付資料完整性'],
 '設備進場':['核對設備標識及核准送審資料','核對數量與外觀紀錄','核對隨附文件與證明','記錄存放條件與待處理事項'],
 '安裝查驗':['確認施工依據及圖說版本','核對安裝位置與標識','核對接口及支撐查驗紀錄','確認維護空間及未結缺失'],
 '測試準備':['確認核准測試程序及版本','確認測試前提與隔離措施紀錄','確認儀器與見證人員資料','確認測試紀錄及未結事項'],
}
export function newInspection(template='資料完整性'):Inspection {return {id:'',title:'',date:'',inspector:'',reviewer:'',asset:'',task:'',document:'',basis:'',evidence:'',items:(inspectionTemplates[template]??inspectionTemplates['資料完整性']!).map((label,i)=>({id:`check-${i+1}`,label,result:'未查驗',note:'',issueId:''})),status:'草稿',reviewNote:'',submittedBy:'',reviewedBy:''}}
export function validateInspection(i:Inspection){if(!i.title.trim()||!i.date||!i.inspector.trim()||!i.reviewer.trim()||!i.basis.trim())throw new Error('請填寫名稱、日期、查驗人、複核人及查驗依據');if(!i.items.length||i.items.some(x=>!x.label.trim())||new Set(i.items.map(x=>x.id)).size!==i.items.length)throw new Error('查驗項目不可空白或重複')}
export function validateInspectionSubmission(i:Inspection){validateInspection(i);if(!i.evidence.trim())throw new Error('請填寫證據位置、文件版本或紀錄說明');if(i.items.some(x=>x.result==='未查驗'))throw new Error('仍有未查驗項目');if(i.items.some(x=>['不合格','不適用'].includes(x.result)&&!x.note.trim()))throw new Error('不合格及不適用項目必須填寫說明')}
