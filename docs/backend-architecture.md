# Ampower 工程數位管理平台：後端架構規劃

## 1. 規劃目標

本文件以目前 Vue 3／Pinia 前端為基礎，將 Local JSON、LocalStorage、GLB 與現場照片逐步移轉為多人可協作、可追蹤、可備份的正式後端。

第一階段的核心原則：

- 以「多專案管理」為上層，所有 WBS、人工時、照片、3D 與 AI 紀錄均隸屬專案。
- 先採模組化單體（Modular Monolith），避免過早拆成微服務。
- 關聯資料進 Supabase 專案 `ezlrxdfiucuhiujfzmkc` 的 PostgreSQL；GLB、圖片與匯入檔統一進 Supabase Storage。
- 施工資料不可直接覆蓋而不留痕：重要變更保留版本、操作者與時間。
- 現階段先管理人工時，不建立材料、機具或單價成本模組。
- AI 影像分析走非同步工作佇列，避免大型照片與模型推論阻塞一般 API。

## 2. 建議技術選型

| 層級 | 建議 | 原因 |
| --- | --- | --- |
| API | Node.js 22 + TypeScript + NestJS（Fastify adapter） | 與現有前端同語言、模組與權限邊界清楚 |
| API 規格 | OpenAPI 3.1 + 產生 TypeScript client | 降低前後端欄位不同步 |
| 資料庫 | Supabase PostgreSQL（project ref: `ezlrxdfiucuhiujfzmkc`） | 由 Supabase 管理 Postgres、連線資訊、監控與資料庫備份 |
| ORM／Migration | Prisma 或 Drizzle（二選一後固定） | Schema migration、型別安全與交易支援 |
| 檔案 | Supabase Storage（S3-compatible API） | 管理 GLB、現場照片、Excel 與封面圖，並與 Auth／RLS 整合，不將大型檔案放入資料庫 |
| 快取／佇列 | Redis + BullMQ | AI 影像分析、GLB 壓縮、Excel 匯入等背景工作 |
| 即時更新 | SSE 優先，必要時 WebSocket | 進度與 AI 工作狀態以單向推播即可起步 |
| 身分驗證 | OIDC（Microsoft Entra ID 優先）+ HttpOnly session | 適合 Ampower 企業帳號與未來業主入口 |
| 可觀測性 | OpenTelemetry + 結構化 log + Sentry | API、工作佇列與前端錯誤可串起追蹤 |

開發環境以 Docker Compose 提供 API 與 Redis，資料庫及物件儲存連至獨立的 Supabase 開發／測試專案；正式環境使用 Supabase 正式專案。不要讓本機測試自動連到正式資料庫或正式 Storage。

### 2.1 Supabase 使用界線

- 本階段使用 **Supabase Database + Supabase Storage**；儲存介面維持 S3-compatible adapter，保留未來切換至 MinIO 的能力。
- 登入架構仍採企業 OIDC + 後端 HttpOnly session；是否改用 Supabase Auth 另案評估。
- Vue 前端不直接取得資料庫密碼或 `service_role` key，也不直接操作正式資料表。
- NestJS API 是唯一正式資料寫入入口，負責 RBAC、交易、版本衝突與 audit log。
- 後端連線字串必須從 Supabase Dashboard 的 **Connect** 取得，不自行拼接 pooler host。
- 長時間運行的 API 優先用 direct connection；若部署環境僅支援 IPv4，改用 Supavisor session mode。Serverless worker 才使用 transaction mode，並依 ORM 規則關閉 prepared statements。
- Migration 使用獨立的 `DIRECT_DATABASE_URL`，應用執行使用 `DATABASE_URL`；兩者均只存於 server secret／CI secret。

預計的環境變數名稱（文件與範例不得放入真實密碼）：

```dotenv
SUPABASE_PROJECT_REF=ezlrxdfiucuhiujfzmkc
DATABASE_URL=postgresql://...             # API 執行連線
DIRECT_DATABASE_URL=postgresql://...      # migration／管理連線
SUPABASE_URL=https://ezlrxdfiucuhiujfzmkc.supabase.co
SUPABASE_STORAGE_S3_ENDPOINT=https://ezlrxdfiucuhiujfzmkc.storage.supabase.co/storage/v1/s3
SUPABASE_STORAGE_S3_ACCESS_KEY_ID=...      # server-only
SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=...  # server-only
```

目標專案：[Supabase Dashboard — ezlrxdfiucuhiujfzmkc](https://supabase.com/dashboard/project/ezlrxdfiucuhiujfzmkc)

## 3. 系統邊界

```text
Vue Web
  │ HTTPS / JSON / multipart / SSE
  ▼
API（單一部署、內部分模組）
  ├─ Identity & RBAC
  ├─ Project Portfolio
  ├─ WBS / Schedule / PERT
  ├─ Progress & Labor Hours
  ├─ 3D Model / POI
  ├─ Site Photo / AI Assistant
  ├─ Import / Export
  └─ Audit
      │             │               │
      ▼             ▼               ▼
 Supabase Postgres  Supabase Storage  Redis / BullMQ
                                      │
                                      ▼
                            AI 與 GLB 背景工作者
```

第一階段 API 與 worker 可共用同一個程式庫、分成兩個 process。當 AI 使用量或模型處理量明顯上升時，再將 worker 獨立擴展。

## 4. 多租戶與權限模型

資料隔離層級：`organization -> project -> project resource`。

採「角色範本 + 個別帳號覆寫 + 資料範圍」三層權限模型。角色範本固定為：

| 角色 | 權限摘要 |
| --- | --- |
| Admin | 管理帳號、權限、專案與系統設定；唯一可建立及停用帳號 |
| Planner | 規劃 WBS、甘特、PERT、3D 對應與版本送審 |
| Manager | 核准／發布 WBS 與模型、查看所有報表、確認進度並調度工班 |
| Worker | 只查看被授權專案，回報被指派工項的進度、人工時與現場照片 |

`role_permissions` 保存角色預設；`user_permission_overrides` 可針對帳號設定
`allow`／`deny`，其中 deny 永遠優先。覆寫可限制於 organization、project 或 assigned_task，
也可設定到期時間。所有查詢必須同時驗證 `organization_id` 與 `project_membership`，
不能只靠前端隱藏功能。帳號狀態、角色與權限的異動皆寫入 `audit_logs`，並禁止停用自己或降級最後一位 Admin。

## 5. 核心資料模型

所有主鍵建議使用 UUIDv7；時間以 UTC 儲存、前端以 Asia/Taipei 顯示。資料表均含 `created_at`、`updated_at`，可編輯主資料加上 `version` 做 optimistic locking。

### 5.1 組織與專案

- `organizations`: Ampower 與未來其他租戶。
- `app_users`: 登入身分、姓名、Email、狀態。
- `organization_members`: 使用者與組織角色。
- `projects`: 編號、名稱、描述、業主、地點、座標、發電機類型、工班、狀態、日期、風險與承攬資訊。
- `project_members`: 專案角色與存取範圍。
- `project_images`: 卡片封面與專案圖庫，實體檔案存 Supabase Storage。
- `project_settings`: 每個專案自己的工時制、工作日、WBS 編碼前綴、自動重算選項、3D 初始視角與影片運鏡開關。

每個專案都有完全獨立的內容範圍：

- `projects.active_schedule_baseline_id` 指向該專案目前發布的 WBS／排程基準。
- `projects.active_model_version_id` 指向該專案目前發布的 3D 模型版本。
- `wbs_tasks.project_id`、`model_versions.project_id`、`model_parts.project_id` 為必要欄位。
- `model_parts.task_id + project_id` 使用複合外鍵，資料庫直接阻止把 A 專案的 3D 元件連到 B 專案的 WBS。
- 新建專案時在同一 transaction 建立 `project_settings` 與空的 `model_sets`；沒有上傳模型或匯入 WBS 時顯示專案自己的空狀態，不回退到其他專案資料。

### 5.2 WBS、排程與 PERT

- `wbs_tasks`: `project_id`、穩定 `code`／`sequence`、名稱、階段、工期、權重、計畫起訖、手動固定日、3D part 關聯。
- `task_dependencies`: `predecessor_task_id`、`successor_task_id`、關係型態（先支援 FS）、lag days。
- `schedule_baselines`: 核准版計畫快照；模擬與草稿不直接覆蓋基準版。
- `schedule_revisions`: Excel 匯入或批次調整的版本、來源檔與差異摘要。
- `progress_updates`: 工項完成度、資料日期、備註、回報者。
- `progress_snapshots`: 專案每日總體進度快照，供 S 曲線快速查詢。

#### WBS 版本管理

- `wbs_versions`: 專案內遞增版本號、標籤、狀態、來源、父版本、完整 snapshot、內容雜湊、變更摘要與核准資訊。
- `wbs_version_events`: 建立、送審、核准、退回、發布與取代事件，提供不可變的操作歷程。
- `projects.active_wbs_version_id`: 目前正式使用的 WBS 版本，必須與專案相同；每個專案同時間最多一個 `published` 版本。
- `project_settings`: 可設定是否需要核准、Excel 匯入前是否自動快照，以及版本標籤格式。
- `wbs_tasks.stable_key` 在版本間保持不變；發布新版時用 stable key upsert，未出現在新版的工項設 `archived_at`，不直接刪除，確保歷史進度與 3D 對應仍可追溯。

版本狀態流程：

```text
draft -> in_review -> published -> superseded
                 └-> rejected -> draft
```

- 草稿可編輯與刪除；送審後鎖定內容，只允許核准或退回。
- 發布使用單一 transaction：驗證工項／相依關係、將舊發布版改為 `superseded`、更新 live WBS、設定 `active_wbs_version_id`、重算排程並寫入 audit/event。
- 舊版不直接「回復覆蓋」。使用者從舊版建立來源為 `restore` 的新草稿，重新送審發布，保留完整版本線。
- Excel 匯入先建立 draft 並產生 compare 結果；使用者確認差異後才可送審或發布。

PERT 最早／最晚日期與要徑仍可由 API 即時計算；核准基準可儲存結果快照以便歷史比對。

### 5.3 人工時

- `labor_categories`: 工種名稱；暫不含費率。
- `labor_plans`: `task_id`、工種、計畫人數、每日標準工時（預設 8）、計畫人工時。
- `labor_entries`: `task_id`、工作日期、工種、人數、投入小時、工班、回報者、備註。
- `labor_daily_summaries`: 可由背景工作或 materialized view 產生，供人工時 S 曲線與跨專案儀表板使用。

實際人工時應記錄逐日明細，不只保留單一累計值；前端需要累計時由 API 彙總。

### 5.4 3D 模型與標記

- `model_templates`: Ampower 組織層級的可重用標準發電機 3D 模板。
- `model_template_parts`: 模板構件、Storage 檔案及預設 WBS stable key 對應。
- `model_sets`: 一個專案可有多個模型版本。
- `model_versions`: 版本號、狀態、原始檔、壓縮檔、檔案雜湊、上傳者、發布時間。
- `model_parts`: 穩定 part key、名稱、群組、類型、檔案位置、bytes、對應 WBS task。
- `model_processing_jobs`: GLB 驗證、壓縮、縮圖、錯誤訊息。
- `pois`: part、世界座標、標題、URL／附件、建立者與狀態。

發布新模型採 immutable version；舊版本不覆蓋，專案只更新 `active_model_version_id`。如此才能回看某次進度照片所對應的 3D 版本。

專案新增／編輯時可選擇「套用 Ampower 標準發電機 3D」。API 不會讓多個專案共用同一筆可修改的 model version，而是從 `model_templates` 建立該專案自己的 immutable `model_versions`／`model_parts`；GLB Storage objects 可唯讀共用以避免重複容量。模板的 `default_wbs_stable_key` 只會對應同一專案目前作用中的 WBS stable key，找不到的項目列為未對應，不能跨專案連結。

### 5.5 現場照片與 AI

- `site_photos`: 專案、拍攝時間、上傳時間、拍攝者、位置、object key、縮圖、EXIF、安全掃描狀態。
- `ai_threads`、`ai_messages`: 問答紀錄與引用照片。
- `ai_analysis_jobs`: queued／running／succeeded／failed、模型版本、輸入摘要、token／時間用量。
- `ai_analysis_results`: 回答、推定進度、信心、對應 task、風險提示與結構化 evidence。

AI 回答不得直接改寫正式進度。流程應是「AI 建議 -> 使用者確認 -> 產生 progress update」，並保留原始照片、模型版本與確認者。

### 5.6 匯入、附件與稽核

- `files`: 共用檔案 metadata、object key、MIME、size、SHA-256、病毒掃描狀態。
- `import_jobs`: WBS Excel 的解析狀態、列級錯誤與套用結果。
- `audit_logs`: actor、action、resource、before／after 摘要、IP、request id。

## 6. API 初稿

統一前綴 `/api/v1`，列表採 cursor pagination；寫入回傳新的 `version`／`ETag`。

### 專案

```http
GET    /projects?status=&q=&cursor=
POST   /projects
GET    /projects/{projectId}
PATCH  /projects/{projectId}
DELETE /projects/{projectId}              # 軟刪除／封存
POST   /projects/{projectId}/restore
POST   /projects/{projectId}/cover
GET    /projects/{projectId}/dashboard
GET    /projects/{projectId}/settings
PATCH  /projects/{projectId}/settings
GET    /projects/{projectId}/content
PATCH  /projects/{projectId}/content      # 選擇作用中的 WBS 與 3D 版本
```

專案 API 的完整欄位與錯誤格式以 [`docs/openapi/projects.yaml`](./openapi/projects.yaml) 為準。
WBS／3D 專案設定與元件映射以 [`docs/openapi/project-content.yaml`](./openapi/project-content.yaml) 為準。

#### 專案新增

- 僅 Ampower 管理員或有 `project_manager` 建立權限者可新增。
- `code` 在 organization 內唯一；所有字串由 API trim，日期統一使用 `YYYY-MM-DD`。
- `POST /projects` 必須帶 `Idempotency-Key`。API 在同一 transaction 建立 `projects`、建立者的 `project_members`，並寫入 `audit_logs`。
- 封面圖採兩階段流程：先建立專案，再取得 `project-images` bucket 的 signed upload URL；上傳成功後登記 `files` 與 `project_images`。

#### 專案編輯

- `PATCH` 僅接受 allowlist 欄位，不允許修改 `organization_id`、建立者與系統時間。
- 前端必須帶最新 `If-Match: W/"{version}"`；API 以 `where id = ? and version = ?` 原子更新並將 version 加一。
- 找不到相同 version 時回 `409`，回應包含目前版本與最近修改時間，避免後寫覆蓋先寫。
- 每次修改將欄位差異寫入 `audit_logs.before_data`／`after_data`，敏感內容只記摘要。

#### 專案刪除與復原

- 一般「刪除」採軟刪除：設定 `status=archived`、`deleted_at`、`deleted_by`、`deletion_reason`，不立即 cascade，也不刪除 Storage 物件。
- 預設清單排除 `deleted_at is not null`；管理員可用 `includeArchived=true` 查看並由 `/restore` 復原。
- 永久清除不放在第一階段公開 API。未來由 Ampower 管理員建立 purge job，至少保留 30 天，先輸出清除清單並再次確認，再按外鍵順序刪除資料與 Storage objects。
- 已完成、進入稽核或有保存義務的專案可封存但不可永久清除。

### WBS 與排程

```http
GET    /projects/{projectId}/tasks
POST   /projects/{projectId}/tasks
PATCH  /projects/{projectId}/tasks/{taskId}
PUT    /projects/{projectId}/tasks/{taskId}/dependencies
POST   /projects/{projectId}/schedule/recalculate
POST   /projects/{projectId}/schedule/baselines
GET    /projects/{projectId}/schedule/pert
POST   /projects/{projectId}/imports/wbs
GET    /projects/{projectId}/imports/{jobId}
GET    /projects/{projectId}/wbs/versions
POST   /projects/{projectId}/wbs/versions
GET    /projects/{projectId}/wbs/versions/{versionId}
PATCH  /projects/{projectId}/wbs/versions/{versionId}
DELETE /projects/{projectId}/wbs/versions/{versionId}       # 僅草稿／退回版
POST   /projects/{projectId}/wbs/versions/{versionId}/submit
POST   /projects/{projectId}/wbs/versions/{versionId}/approve
POST   /projects/{projectId}/wbs/versions/{versionId}/publish
GET    /projects/{projectId}/wbs/versions/compare?from=&to=
```

WBS 版本 API 合約以 [`docs/openapi/wbs-versioning.yaml`](./openapi/wbs-versioning.yaml) 為準。

### 進度與人工時

```http
POST   /projects/{projectId}/tasks/{taskId}/progress
GET    /projects/{projectId}/progress/curve
GET    /projects/{projectId}/labor/summary?from=&to=
POST   /projects/{projectId}/tasks/{taskId}/labor-plans
POST   /projects/{projectId}/tasks/{taskId}/labor-entries
PATCH  /projects/{projectId}/labor-entries/{entryId}
DELETE /projects/{projectId}/labor-entries/{entryId}
```

### 3D、照片與 AI

```http
GET    /projects/{projectId}/models/active
POST   /projects/{projectId}/models/uploads          # 取得 presigned upload URL
GET    /model-templates
POST   /projects/{projectId}/models/apply-template   # 套用 Ampower 標準發電機 3D
POST   /projects/{projectId}/models/{versionId}/publish
GET    /projects/{projectId}/pois
POST   /projects/{projectId}/pois
PATCH  /projects/{projectId}/pois/{poiId}
POST   /projects/{projectId}/photos/uploads          # 取得 presigned upload URL
POST   /projects/{projectId}/ai/analyses
GET    /projects/{projectId}/ai/analyses/{jobId}
GET    /projects/{projectId}/events                  # SSE
```

大型檔案由瀏覽器透過 Supabase Storage resumable upload 或 signed upload URL 直接上傳；API 僅簽發授權並登記 metadata，避免照片或 GLB 以 base64 穿過 API。分成 `models`、`site-photos`、`project-images`、`imports` 四個 private bucket，所有下載均使用短效 signed URL。伺服器如使用 S3 protocol，其 access key 必須保留在後端。

3D 模板 API 合約以 [`docs/openapi/model-templates.yaml`](./openapi/model-templates.yaml) 為準。

## 7. 一致性與併發策略

- 專案、WBS 與人工時寫入使用 transaction。
- `PATCH` 必須帶 `If-Match` 或 `version`；版本落後回 `409 Conflict`，前端提示重新載入或合併。
- 進度與人工時採 append-first：修改建立更正版並保留 audit，而非不可追蹤地覆蓋。
- Excel 匯入分成 validate 與 apply 兩步；使用者先看到差異與錯誤，再確認套用。
- 3D 發布採狀態機：uploaded -> processing -> ready -> published／failed。
- API 的 idempotency key 用於建立專案、照片登記與匯入工作，避免重送產生重複資料。

## 8. 安全與資料治理

- Cookie session 設 `HttpOnly`、`Secure`、`SameSite=Lax`；寫入 API 做 CSRF 防護。
- 每個 endpoint 進行 project membership authorization。
- 上傳限制副檔名、MIME、容量與檔案數，並做 malware scan；下載使用短效 signed URL。
- AI 僅接收該專案被選取的照片與必要排程摘要，不傳整個資料庫。
- AI prompt、模型名稱、輸入照片、結果與使用者確認均保留追溯資料。
- Supabase 依方案提供資料庫備份；正式上線前確認保留天數與是否啟用 PITR，並另排程 `supabase db dump`／`pg_dump` 至異地備份。Supabase Storage 目前不提供 S3 object versioning，因此重要模型與現場照片另做異地物件備份。
- Supabase 的資料庫備份不涵蓋 Storage 物件，因此資料庫與物件必須各自做還原演練。
- 敏感 log 不記錄照片內容、session、token 或完整 AI prompt payload。

## 9. 前端改造方式

先新增 Repository 介面，不立刻重寫所有 Pinia store：

```ts
interface ProjectRepository {
  list(query?: ProjectListQuery): Promise<ProjectPage>
  get(projectId: string): Promise<ProjectDetail>
  create(input: ProjectCreateInput, idempotencyKey: string): Promise<ProjectDetail>
  update(projectId: string, patch: ProjectPatch, version: number): Promise<ProjectDetail>
  archive(projectId: string, version: number, reason?: string): Promise<ProjectDetail>
  restore(projectId: string, version: number): Promise<ProjectDetail>
}
```

同一介面提供：

- `LocalProjectRepository`：沿用目前 JSON／LocalStorage，支援離線 demo。
- `ApiProjectRepository`：呼叫 `/api/v1`。

之後依序為 schedule、labor、poi、photo／AI 建立 repository。Pinia 負責 UI state 與快取，不再是唯一資料來源。`projectId` 必須進入每一個 store／route，避免多專案共用同一組 LocalStorage key。

專案切換時必須取消上一個專案尚未完成的 API request、清空 schedule／viewer／POI store，再以新 `projectId` 載入設定、WBS 與 active model。任何 API response 的 `projectId` 與目前 route 不同時直接丟棄，避免慢回應污染另一個專案。

### 9.1 專案設定介面

專案總覽的「設定」分成五頁：

1. 基本資料：名稱、業主、地點、工班、發電機類型、日期與封面。
2. WBS／排程：Excel 匯入、作用中 baseline、每日工時、工作日、自動重算。
3. 3D 模型：模型版本上傳、處理狀態、預覽、發布及作用中版本。
4. WBS × 3D 對應：左側 WBS、右側模型元件，支援搜尋、批次綁定與未對應檢查。
5. 成員與權限：專案經理、工程師、工班、業主與唯讀訪客。

發布新的 WBS baseline 或 3D version 不直接覆蓋舊版。使用者先預覽，確認發布後才更新 `projects.active_schedule_baseline_id` 或 `projects.active_model_version_id`，並寫入 audit log。

在基本資料的專案新增／編輯表單先提供兩種 3D 來源：「Ampower 發電機標準 3D」及「專案專屬模型」。選擇標準 3D 時顯示模板名稱、構件數與相容 WBS；儲存後呼叫 apply-template API。選擇專屬模型則建立空 model set，進入專案後再上傳 GLB。

WBS／排程頁另設「版本」抽屜，顯示版本號、狀態、建立者、來源、發布時間與變更摘要；支援兩版比較、從舊版建立新草稿、送審、核准、退回與發布。一般使用者不可直接修改已發布版本。

## 10. LocalStorage 資料遷移

目前需遷移的 key：

| 現況 | 後端目的地 |
| --- | --- |
| `ampower-project-data-json-v1` | projects、project_images |
| `generator-schedule-v2` | wbs_tasks、progress_updates／snapshots、使用者播放偏好分流 |
| `generator-wbs-labor-hours-v1` | labor_plans、labor_entries |
| `generator-pois-v1` | pois |
| `generator-layout-v2` 等畫面偏好 | user_preferences；也可繼續留本機 |

首次登入提供一次性「匯入本機資料」：前端讀取 key，送到 `/migrations/local-data/validate`，顯示預覽後再 `/apply`。伺服器記錄 migration id，重送不重複匯入。成功後先保留本機資料 30 天，不自動刪除。

## 11. 建議專案結構

```text
app/                         # 現有 Vue 前端
server/
  src/
    modules/
      identity/
      projects/
      schedule/
      progress/
      labor/
      models/
      photos/
      ai/
      imports/
      audit/
    common/
    main.ts
  prisma/                    # 或 drizzle/；migration 送至 Supabase
  test/
packages/
  contracts/                 # OpenAPI 產生型別與共用 enum
infra/
  docker-compose.yml
  migrations/
docs/
```

## 12. 分階段交付

### Phase 0：架構骨架（約 1 週）

- 建立 server、Supabase migration、Storage buckets／policies、OpenAPI、健康檢查與 Docker Compose（Redis）。
- 建立 organization／user／project 與 RBAC 基礎。
- CI 執行 lint、unit test、migration check、build。

完成條件：開發環境可一鍵啟動；可登入並讀取本人有權限的專案。

### Phase 1：專案、WBS、進度與人工時（約 2–3 週）

- Project Portfolio API。
- WBS／dependency／排程計算、baseline、進度快照。
- 人工時 plan／entry／summary。
- Excel validate／apply。
- 前端 repository adapter 與 local-data migration。

完成條件：兩位使用者可在不同裝置編輯同一專案；衝突可偵測；S 曲線與人工時由 API 重建。

### Phase 2：檔案、3D 與現場協作（約 2 週）

- Presigned upload、檔案掃描與縮圖。
- GLB model version／processing／publish。
- POI 與照片歷程。
- SSE 工作狀態更新。

完成條件：新 3D 版本可上傳、背景處理、審核發布並回看舊版。

### Phase 3：AI 現場助手與業主入口（約 2 週）

- AI job、結構化結果、證據與人工確認流程。
- 業主唯讀 portal、報表下載與查驗紀錄。
- 用量、錯誤與稽核儀表板。

完成條件：照片分析不直接改正式進度；確認後才建立可追溯的 progress update。

## 13. 第一個實作切點

建議第一個 vertical slice 是「專案清單 + 單一專案 WBS + 人工時」：

1. 建立 identity、projects、wbs_tasks、task_dependencies、labor_plans、labor_entries 六組核心 schema。
2. 實作專案清單、WBS 讀寫、人工時讀寫 API。
3. 將 `projectRepository` 改造成 Local／API 雙實作。
4. 將 schedule 與 labor store 接到 API，保留本機 demo mode。
5. 驗證 RBAC、optimistic locking、audit log 與備份還原。

這個切點能先解決目前最重要的多人、多專案與人工時資料共享，同時不阻塞後續 3D、照片與 AI 模組。
