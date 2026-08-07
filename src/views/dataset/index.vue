<template>
  <div class="ds-page">
    <div class="flow-bar">
      <div class="flow-node">
        <el-icon><Coin /></el-icon>
        <span>数据总量</span>
        <b>{{ totalItems }}</b>
      </div>
      <el-icon class="flow-arrow"><ArrowRight /></el-icon>
      <div class="flow-node" :class="{active: tab==='clean'}">
        <el-icon><Folder /></el-icon>
        <span>清洗数据集</span>
        <b>{{ totalGov }}</b>
      </div>
      <el-icon class="flow-arrow"><ArrowRight /></el-icon>
      <div class="flow-node" :class="{active: tab==='prod'}">
        <el-icon><CircleCheck /></el-icon>
        <span>生产数据集</span>
        <b>{{ totalProd }}</b>
      </div>
      <el-icon class="flow-arrow"><ArrowRight /></el-icon>
      <div class="flow-node">
        <el-icon><Download /></el-icon>
        <span>COCO导出</span>
      </div>
    </div>

    <div class="stat-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="stat-num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <div class="body-row">
      <el-card shadow="never" class="list-panel">
        <template #header>
          <div class="panel-head">
            <div style="display:flex;align-items:center;gap:12px">
              <span>数据集列表（{{ filteredList.length }}）</span>
              <el-radio-group v-model="tab" size="small" @change="onTabChange">
                <el-radio-button value="clean" v-if="showCleanOnly">清洗数据</el-radio-button>
                <template v-if="!showCleanOnly">
                <el-radio-button value="all">全部</el-radio-button>
                <el-radio-button value="clean">清洗数据</el-radio-button>
                <el-radio-button value="prod">生产数据</el-radio-button>
                </template>
              </el-radio-group>
            </div>
            <div style="display:flex;gap:8px">
              <el-input v-model="searchKey" placeholder="搜索" clearable :prefix-icon="Search" style="width:160px" />
              <el-button type="primary" :icon="Upload" size="small" @click="openImport">导入数据</el-button>
              <el-button v-if="userStore.isAdmin" size="small" :icon="Setting" @click="openDimEditor">维度</el-button>
            </div>
          </div>
        </template>
        <el-table :data="filteredList" border size="small" v-loading="loading" @expand-change="onExpand">
          <el-table-column type="expand">
            <template #default="s">
              <div class="expand-items" v-loading="getExpand(s.row).loading">
                <el-table :data="getExpand(s.row).items" border size="small">
                  <el-table-column label="数据路径" prop="itemName" min-width="160" show-overflow-tooltip />
                  <el-table-column label="批次" min-width="70"><template #default="r">{{ r.row.metadata?.batch || '-' }}</template></el-table-column>
                  <el-table-column label="车型" min-width="70"><template #default="r">{{ r.row.metadata?.model || '-' }}</template></el-table-column>
                  <el-table-column label="单包检测" min-width="80"><template #default="r">{{ r.row.metadata?.check || '-' }}</template></el-table-column>
                  <el-table-column label="场景" min-width="120"><template #default="r"><el-tag v-for="t in (r.row.tags||[])" :key="t" size="small" effect="plain" type="success" style="margin:1px">{{ t }}</el-tag><span v-if="!(r.row.tags||[]).length" style="color:#c0c4cc">-</span></template></el-table-column>
                  <el-table-column label="清洗人" min-width="70"><template #default="r">{{ r.row.metadata?.cleaner || '-' }}</template></el-table-column>
                  <el-table-column label="清洗时间" min-width="110"><template #default="r">{{ r.row.metadata?.cleanTime || '-' }}</template></el-table-column>
                  <el-table-column label="操作" width="80"><template #default="r"><el-button text size="small" type="primary" @click="browseSingle(s.row,r.row)">查看</el-button></template></el-table-column>
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="数据集名称" prop="name" min-width="150" show-overflow-tooltip />
          <el-table-column label="状态" width="80">
            <template #default="s"><el-tag :type="statusTagType(s.row.status)" size="small">{{ s.row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column label="数据量" prop="itemCount" width="70" />
          <el-table-column label="标签进度" width="120">
            <template #default="s">
              <el-progress :percentage="s.row.itemCount ? Math.round(s.row.taggedCount/s.row.itemCount*100) : 0" :stroke-width="6" /><span style="font-size:11px">{{ s.row.taggedCount }}/{{ s.row.itemCount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="标注/场景标签" min-width="130">
            <template #default="s">
              <el-tag v-for="l in s.row.labelDist?.slice(0,2)" :key="l.name" size="small" type="primary" effect="plain" style="margin:1px">{{ l.name }}×{{ l.value }}</el-tag>
              <el-tag v-for="l in s.row.scenarioDist?.slice(0,2)" :key="l.name" size="small" type="success" effect="plain" style="margin:1px">{{ l.name }}×{{ l.value }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="s">
              <el-button text size="small" type="primary" @click="browseDS(s.row)">浏览</el-button>
              <template v-if="s.row.source==='gov'">
                <el-button v-if="s.row.status!=='TAGGED'" text size="small" type="success" @click="onMarkTagged(s.row)">已清洗</el-button>
                <el-button v-else text size="small" type="warning" @click="onMarkTagged(s.row,'RAW')">退回</el-button>
              </template>
              <el-button v-if="s.row.source==='prod'" text size="small" type="success" @click="exportDS(s.row)">导出</el-button>
              <el-popconfirm title="确定删除此数据集？" @confirm="onDeleteDS(s.row)"><template #reference><el-button text size="small" type="danger">删除</el-button></template></el-popconfirm>
            </template>
          </el-table-column>
          <template #empty><el-empty description="暂无数据集" :image-size="80" /></template>
        </el-table>
      </el-card>

      <el-card shadow="hover">
        <template #header><span>场景分类统计</span></template>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="grid-column:1/3"><div ref="scenarioChartRef" style="height:420px" /></div>
        </div>
      </el-card>
    </div>

    <!-- 导入 -->
    <el-dialog v-model="importVisible" title="数据导入" width="520px">
      <el-steps :active="importStep" simple class="import-steps"><el-step title="选择文件"/><el-step title="配置信息"/></el-steps>
      <div style="margin-bottom:8px">
        <el-radio-group v-model="importMode" size="small">
          <el-radio-button value="file">上传文件</el-radio-button>
          <el-radio-button value="paste">粘贴数据</el-radio-button>
        </el-radio-group>
      </div>
      <div v-show="importStep===0 && importMode==='file'" style="margin-top:12px">
        <input type="file" ref="fileInputRef" accept=".csv,.xlsx,.xls,.zip,.json,.jsonl" style="display:none" @change="onNativeFileChange" />
        <div class="drop-zone" @click="fileInputRef?.click()" @dragover.prevent @drop.prevent="onDrop">
          <el-icon size="40"><UploadFilled /></el-icon>
          <div class="el-upload__text">点击或拖拽文件到这里</div>
        </div>
        <div v-if="importForm.fileName" class="file-sel"><el-icon><Document /></el-icon>{{ importForm.fileName }}</div>
      </div>
      <div v-show="importStep===0 && importMode==='paste'" style="margin-top:12px">
        <el-input v-model="pasteText" type="textarea" :rows="10" placeholder="源数据路径（logs）,批次,车型,单包检测,场景,清洗人,清洗时间,感知意见"
          />
        <el-button style="margin-top:8px" type="primary" size="small" @click="onParsePaste">解析并继续</el-button>
      </div>
      <div v-show="importStep===1" style="margin-top:20px">
        <el-form label-width="90px">
          <el-form-item label="数据集名称" required><el-input v-model="importForm.name" placeholder="如 DS_001_street"/></el-form-item>
          <el-form-item label="数据量"><el-input-number v-model="importForm.itemCount" :min="1" :max="500" style="width:100%"/></el-form-item>
          <el-form-item v-if="isVideo" label="提取帧数"><span style="color:#909399;font-size:13px">视频将按每 {{ Math.ceil(importForm.itemCount/10) }} 帧抽取 1 帧，模拟生成 {{ importForm.itemCount }} 个样本帧</span></el-form-item>
          <el-alert type="info" :closable="false" :title="isVideo ? '视频文件将抽帧生成 Dataset' : '系统将自动解压、MD5校验、抽取元数据'" style="margin-top:8px"/>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="importVisible=false">取消</el-button>
        <el-button v-if="importStep===0" type="primary" :disabled="!importForm.fileName" @click="importStep=1">下一步</el-button>
        <template v-else><el-button @click="importStep=0">上一步</el-button><el-button type="primary" :loading="actionLoading" :disabled="!importForm.name" @click="onImport">确认导入</el-button></template>
      </template>
    </el-dialog>

    <!-- 浏览 -->
    <el-drawer v-model="browseVisible" :title="currentDS?.name" size="780px">
      <div class="browse-head">
        <el-tag :type="currentDS?.status==='TAGGED'?'success':'warning'">{{ currentDS?.status }}</el-tag>
        <span class="browse-count">{{ browseItems.length }}条</span>
        <el-button v-if="selectedIds.length" size="small" type="warning" @click="openBatch">批量打标签({{selectedIds.length}})</el-button>
      </div>
      <div class="browse-body">
        <div class="browse-list">
          <el-checkbox-group v-model="selectedIds">
            <div v-for="it in browseItems" :key="it.id" class="b-item" :class="{active:currentItem?.id===it.id}" @click="selectItem(it)">
              <el-checkbox :value="it.id" class="bi-check" @click.stop/>
                <div class="bi-info"><div class="bi-name">{{ it.itemName }}</div>
                  <div class="bi-tags"><el-tag v-for="t in (it.tags||[])" :key="t" size="small" effect="dark" type="success" style="margin:1px;cursor:pointer" @click.stop="removeTag(it,t)">{{ t }} ✕</el-tag><span v-if="!(it.tags||[]).length" style="color:#c0c4cc;font-size:11px">未打标签</span></div>
                </div>
                <el-button text size="small" type="danger" style="margin-left:auto;flex-shrink:0" @click.stop="onDeleteItem(it)">✕</el-button>
            </div>
          </el-checkbox-group>
        </div>
        <div class="browse-main">
          <div class="canvas-box"><canvas ref="canvasRef" width="640" height="360"/></div>
          <div class="tag-panel"><div class="ps-title">场景标签</div>
            <div v-if="currentItem" class="dim-list">
              <div v-for="dim in dimensions" :key="dim.id" class="dim-g"><div class="dim-l">{{ dim.label }}</div>
                <div class="dim-t"><el-checkbox-button v-for="t in dim.tags" :key="t" :label="t" :model-value="editTags.includes(t)" size="small" style="margin:2px" @change="()=>toggleTag(t)">{{ t }}</el-checkbox-button></div>
              </div>
              <div class="dim-g"><div class="dim-l">字段编辑（点击选择）</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                  <div><div style="font-size:12px;color:#909399">批次</div><el-select v-model="editMeta.batch" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.batch" :key="v" :label="v" :value="v" /></el-select></div>
                  <div><div style="font-size:12px;color:#909399">车型</div><el-select v-model="editMeta.model" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.model" :key="v" :label="v" :value="v" /></el-select></div>
                  <div><div style="font-size:12px;color:#909399">单包检测</div><el-select v-model="editMeta.check" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.check" :key="v" :label="v" :value="v" /></el-select></div>
                  <div><div style="font-size:12px;color:#909399">场景</div><el-select v-model="editMeta.scene" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.scene" :key="v" :label="v" :value="v" /></el-select></div>
                  <div><div style="font-size:12px;color:#909399">清洗人</div><el-select v-model="editMeta.cleaner" multiple filterable allow-create size="small" style="width:100%" placeholder="选择或输入"><el-option v-for="v in fieldPool.cleaner" :key="v" :label="v" :value="v" /></el-select></div>
                </div>
              </div>
              <div class="dim-g"><div class="dim-l">清洗时间</div>
                <el-date-picker v-model="editCleanTime" type="datetime" size="small" style="width:100%" value-format="YYYY-MM-DD HH:mm:ss" />
              </div>
              <el-button type="primary" :icon="Check" style="width:100%;margin-top:12px" @click="saveTag">保存标签</el-button>
            </div>
            <el-empty v-else description="选择数据" :image-size="40"/>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 批量打标签 -->
    <el-dialog v-model="batchVisible" title="批量打标签" width="500px">
      <div class="dim-list"><div v-for="dim in dimensions" :key="dim.id" class="dim-g"><div class="dim-l">{{ dim.label }}</div>
        <div class="dim-t"><el-checkbox-button v-for="t in dim.tags" :key="t" :label="t" :model-value="batchTags.includes(t)" size="small" style="margin:2px" @change="()=>toggleBatchTag(t)">{{ t }}</el-checkbox-button></div>
      </div></div>
      <template #footer><el-button @click="batchVisible=false">取消</el-button><el-button type="primary" @click="confirmBatch">应用到{{selectedIds.length}}条</el-button></template>
    </el-dialog>

    <!-- 维度管理 -->
    <el-dialog v-model="dimVisible" title="场景维度管理" width="580px">
      <el-table :data="dimensions" border size="small">
        <el-table-column label="维度" prop="label" width="110"/>
        <el-table-column label="标签"><template #default="s"><el-tag v-for="t in s.row.tags" :key="t" size="small" style="margin:1px">{{ t }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="60"><template #default="s"><el-button text size="small" type="danger" @click="onDeleteDim(s.row)">删除</el-button></template></el-table-column>
      </el-table>
      <div style="margin-top:12px;display:flex;gap:8px"><el-input v-model="newDim.label" placeholder="维度名称" style="width:110px"/><el-input v-model="newDim.tagsStr" placeholder="标签(逗号分隔)" style="flex:1"/><el-button type="primary" size="small" @click="onAddDim">添加</el-button></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref,reactive,computed,onMounted,onUnmounted,nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage,ElMessageBox } from 'element-plus'
import { Search,Setting,Upload,Check,UploadFilled,Document,ArrowRight,Download,CircleCheck,Folder } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { fetchDatasets,fetchDatasetItems } from '@/api/dataset.js'
import { fetchGovernedDatasets,fetchGovernedDetail,importDataset,importDatasetFile,updateDatasetStatus,tagGovernedItem,batchTagGovernedItems,deleteGovernedItem,deleteDataset } from '@/api/governance.js'
import { fetchDim,saveDim,deleteDim } from '@/api/tagging.js'
import { saveItemTags,batchSaveTags } from '@/api/tagging.js'
import { deleteTaskItemApi } from '@/api/items.js'
import { useDownload } from '@/composables/useDownload'

const userStore=useUserStore()
const { downloadFile } = useDownload()
const showCleanOnly=computed(()=>[6,7].includes(userStore.userInfo.roleType))
const fieldPool=computed(()=>{
  const dim={model:new Set()}
  dimensions.value.forEach(d=>{
    if(/车型|model/i.test(d.label)) d.tags.forEach(t=>dim.model.add(t))
    else dim.scene.add(d.label+':'+t) === undefined // placeholder
  })
  // 场景维度（不含车型）的标签归入场景
  const sceneSet=new Set(),modelSet=new Set(dim.model)
  dimensions.value.forEach(d=>{
    if(/车型|model/i.test(d.label)) d.tags.forEach(t=>modelSet.add(t))
    else d.tags.forEach(t=>sceneSet.add(t))
  })
  // 历史数据值
  const batchSet=new Set(),checkSet=new Set(),cleanerSet=new Set()
  browseItems.value.forEach(it=>{
    const m=it.metadata||{}
    if(m.batch)(m.batch.split(',')||[]).forEach(v=>batchSet.add(v))
    if(m.check)(m.check.split(',')||[]).forEach(v=>checkSet.add(v))
    if(m.cleaner)(m.cleaner.split(',')||[]).forEach(v=>cleanerSet.add(v))
    if(m.model)(m.model.split(',')||[]).forEach(v=>modelSet.add(v))
    if(m.sceneStr)(m.sceneStr.split(',')||[]).forEach(v=>sceneSet.add(v))
  })
  return { batch:[...batchSet],model:[...modelSet],check:[...checkSet],scene:[...sceneSet],cleaner:[...cleanerSet] }
})
const loading=ref(false),actionLoading=ref(false)
const allDatasets=ref([])
const globalLabelDist=ref([]),globalScenarioDist=ref([])
const searchKey=ref(''),sourceFilter=ref(''),tab=ref('')

function initFilterByRole() {
  const r = userStore.userInfo.roleType
  if (r === 6 || r === 7) { tab.value = 'clean'; sourceFilter.value = 'clean' }
}
const scenarioChartRef=ref(null),canvasRef=ref(null)
let scenarioChart=null
const expandedItems = reactive({})

const importVisible=ref(false),importStep=ref(0),importMode=ref('file'),pasteText=ref('')
const importForm=reactive({name:'',fileName:'',fileSize:0,itemCount:30})
const isVideo=computed(()=>/\.(mp4|avi|mov|mkv)$/i.test(importForm.fileName))
const rawFile=ref(null)
const fileInputRef=ref(null)
const browseVisible=ref(false),currentDS=ref(null),browseItems=ref([]),currentItem=ref(null),selectedIds=ref([]),editTags=ref([]),dimensions=ref([])
const customTag=ref(''),editCleanTime=ref('')
const editMeta=reactive({batch:[],model:[],check:[],scene:[],cleaner:[]})
const batchVisible=ref(false),batchTags=ref([]),dimVisible=ref(false),newDim=reactive({label:'',tagsStr:''})
let imgEl=null

const statusTagType=s=>({TAGGED:'success',ARCHIVED:'success',ACCEPTED:'success',RAW:'warning'}[s]||'')

const filteredList=computed(()=>{
  let l=allDatasets.value
  if(sourceFilter.value==='clean') l=l.filter(d=>d.source==='gov')
  else if(sourceFilter.value==='prod') l=l.filter(d=>d.source==='prod')
  if(searchKey.value.trim()){const k=searchKey.value.trim().toLowerCase();l=l.filter(d=>d.name.toLowerCase().includes(k))}
  return l
})

function onTabChange(val) { sourceFilter.value = val === 'all' ? '' : val }

function getExpand(row) {
  const key = (row.source || '') + '_' + (row.id || row.taskId)
  return expandedItems[key] || { loading: false, items: [] }
}

async function onExpand(row, expandedRows) {
  const key = (row.source || '') + '_' + (row.id || row.taskId)
  if (expandedItems[key]) return
  expandedItems[key] = { loading: true, items: [] }
  try {
    const isGov = row.source === 'gov'
    let items
    if (isGov) { const r = await fetchGovernedDetail(row.id); items = r.data?.items }
    else { const r = await fetchDatasetItems(row.taskId || row.id); items = r.data?.items }
    expandedItems[key] = { loading: false, items: items || [] }
  } catch { expandedItems[key] = { loading: false, items: [] } }
}

function browseSingle(dsRow, itemRow) {
  currentDS.value = dsRow; browseVisible.value = true; browseItems.value = [itemRow]
  currentItem.value = itemRow; selectedIds.value = []
  editTags.value = [...(itemRow.tags || [])]
  nextTick(() => { if (itemRow.image && canvasRef.value) { imgEl = new Image(); imgEl.onload = renderCanvas; imgEl.src = itemRow.image } })
}

const totalGov=computed(()=>allDatasets.value.filter(d=>d.source==='gov').length)
const totalProd=computed(()=>allDatasets.value.filter(d=>d.source==='prod').length)
const totalItems=computed(()=>allDatasets.value.reduce((a,d)=>a+d.itemCount,0))
const totalTagged=computed(()=>allDatasets.value.reduce((a,d)=>a+d.taggedCount,0))
const totalCategories=computed(()=>globalScenarioDist.value.length+globalLabelDist.value.length)

const statCards=computed(()=>[
  {key:'items',val:totalItems.value,label:'数据总量',color:'#409eff'},
  {key:'gov',val:totalGov.value,label:'清洗数据集',color:'#e6a23c'},
  {key:'prod',val:totalProd.value,label:'生产数据集',color:'#67c23a'}
])

async function loadAll(){
  loading.value=true
  try{
    const [gov,prod]=await Promise.all([fetchGovernedDatasets(),fetchDatasets()])
    globalScenarioDist.value=[];globalLabelDist.value=[]
    const merged=[]
    ;(gov.data||[]).forEach(d=>{d.source='gov';d.annotateType=d.annotateType||'-';merged.push(d);
      (d.labelDist||[]).forEach(s=>{const f=globalScenarioDist.value.find(x=>x.name===s.name);if(f)f.value+=s.value;else globalScenarioDist.value.push({...s})})
    })
    const prodDatasets = prod.data?.datasets || []
    prodDatasets.forEach(d=>{d.source='prod';d.name=d.taskName;merged.push(d);
      d.scenarioDist?.forEach(s=>{const f=globalScenarioDist.value.find(x=>x.name===s.name);if(f)f.value+=s.value;else globalScenarioDist.value.push({...s})})
    })
    // 治理数据集的标签(labelDist)即场景标签，已在上面聚合
    globalLabelDist.value=prodDatasets.flatMap(d=>d.labelDist||[]).reduce((a,l)=>{const f=a.find(x=>x.name===l.name);if(f)f.value+=l.value;else a.push({...l});return a},[])
    allDatasets.value=merged.sort((a,b)=>b.id-a.id)
    Object.keys(expandedItems).forEach(k=>delete expandedItems[k])
    await nextTick();initChart()
  }catch{allDatasets.value=[]}
  finally{loading.value=false}
}

function initChart(){
  const pieOpt2=d=>({tooltip:{trigger:'item',formatter:'{b}: {c} ({d}%)'},legend:{bottom:0,textStyle:{fontSize:13}},series:[{type:'pie',radius:['35%','62%'],center:['50%','45%'],data:d.length?d:[{name:'暂无',value:1}],label:{formatter:'{b} {c}',fontSize:14},labelLine:{length:12,length2:8}}]})
  if(scenarioChartRef.value){if(scenarioChart)scenarioChart.dispose();scenarioChart=echarts.init(scenarioChartRef.value);scenarioChart.setOption(pieOpt2(globalScenarioDist.value))}
}

// 导入
function openImport(){importStep.value=0;importMode.value='file';importForm.name='';importForm.fileName='';importForm.fileSize=0;importForm.itemCount=30;rawFile.value=null;pasteText.value='';if(fileInputRef.value)fileInputRef.value.value='';importVisible.value=true}
function onNativeFileChange(e) { handleFile(e.target.files[0]) }
function onDrop(e) { handleFile(e.dataTransfer?.files[0]) }
function handleFile(file) {
  if (!file) return
  rawFile.value = file
  importForm.fileName = file.name
  importForm.fileSize = file.size
  if (!importForm.name) importForm.name = file.name.replace(/\.(zip|tar|gz|7z|csv|xlsx|xls|json|jsonl|mp4|avi|mov|mkv)$/i, '')
  const m = file.name.match(/_(\d+)\./); if (m) importForm.itemCount = Math.min(Number(m[1]), 500)
}
function fmtSize(b){if(!b)return'0 B';const u=['B','KB','MB','GB'];let i=0,s=b;while(s>=1024&&i<3){s/=1024;i++}return s.toFixed(1)+' '+u[i]}
async function onImport(){
  if(!importForm.name.trim()){ElMessage.warning('请输入名称');return}
  actionLoading.value=true
  try{
    let fileData = null, fileName = importForm.fileName
    if (importMode.value === 'paste' && pasteText.value.trim()) {
      // Blob → FileReader → base64（兼容中文）
      const blob = new Blob([pasteText.value], { type: 'text/csv' })
      fileData = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(blob)
      })
      fileName = 'pasted.csv'
    } else if (rawFile.value) {
      fileData = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(rawFile.value)
      })
    }
    if (fileData) {
      await importDatasetFile({ name: importForm.name, fileName, fileData, fileSize: importForm.fileSize || fileData.length, itemCount: 0 })
    } else {
      await importDataset({ name: importForm.name, fileName: importForm.fileName, fileSize: importForm.fileSize, itemCount: importForm.itemCount })
    }
    ElMessage.success('已导入'); importVisible.value = false; loadAll()
  } catch(e) { ElMessage.error(e.message || '导入失败') }
  finally { actionLoading.value = false }
}

function onParsePaste() {
  if (!pasteText.value.trim()) { ElMessage.warning('请先粘贴数据'); return }
  importForm.fileName = 'pasted.csv'
  importForm.fileSize = pasteText.value.length
  if (!importForm.name) importForm.name = 'Pasted_Dataset'
  importStep.value = 1
}

// 状态变更
async function onMarkTagged(row,status){const t=status||'TAGGED';try{await ElMessageBox.confirm(`确认将「${row.name}」标记为「${t}」？`,'状态变更',{type:'warning'})}catch{return};try{await updateDatasetStatus(row.id,t);row.status=t;ElMessage.success('已更新')}catch{}}

// 浏览
async function browseDS(row){currentDS.value=row;browseVisible.value=true;browseItems.value=[];currentItem.value=null;selectedIds.value=[]
  try{
    let items;const isGov=row.source==='gov'
    if(isGov){const r=await fetchGovernedDetail(row.id);items=r.data?.items}
    else{const r=await fetchDatasetItems(row.taskId||row.itemId||row.id);items=r.data?.items}
    browseItems.value=items||[];if(browseItems.value.length)selectItem(browseItems.value[0])
  }catch{}
  try{const d=await fetchDim();dimensions.value=d.data||[]}catch{}
}
function selectItem(it){currentItem.value=it;editTags.value=[...(it.tags||[])];const ct=it.metadata?.cleanTime;const now=new Date().toLocaleString('zh-CN',{hour12:false}).replace(/\//g,'-');editCleanTime.value=ct||now;const m=it.metadata||{};editMeta.batch=m.batch?[m.batch]:[];editMeta.model=m.model?[m.model]:[];editMeta.check=m.check?[m.check]:[];editMeta.scene=m.sceneStr?[m.sceneStr]:[];editMeta.cleaner=m.cleaner?[m.cleaner]:[];customTag.value='';nextTick(()=>{if(it.image&&canvasRef.value){imgEl=new Image();imgEl.onload=renderCanvas;imgEl.src=it.image}})}
function renderCanvas(){const c=canvasRef.value;if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);if(imgEl)ctx.drawImage(imgEl,0,0,c.width,c.height);const cols=['#ff4d4f','#52c41a','#1890ff','#faad14','#722ed1','#13c2c2'];(currentItem.value?.boxes||[]).forEach((b,i)=>{const co=cols[i%cols.length];ctx.strokeStyle=co;ctx.lineWidth=2;ctx.strokeRect(b.x,b.y,b.w,b.h);ctx.fillStyle=co;ctx.font='13px sans-serif';const lw=ctx.measureText(b.label).width+8;ctx.fillRect(b.x,Math.max(0,b.y-18),lw,18);ctx.fillStyle='#fff';ctx.fillText(b.label,b.x+4,Math.max(13,b.y-4))})}
function toggleTag(t){const i=editTags.value.indexOf(t);if(i>=0)editTags.value.splice(i,1);else editTags.value.push(t)}
function toggleBatchTag(t){const i=batchTags.value.indexOf(t);if(i>=0)batchTags.value.splice(i,1);else batchTags.value.push(t)}

// 保存标签（治理用governance API，生产用tagging API）
async function saveTag(){if(!currentItem.value)return
  const isGov=currentDS.value?.source==='gov'
  try{
    if(isGov){
      await tagGovernedItem(currentItem.value.id,{tags:editTags.value,cleanTime:editCleanTime.value,batch:(editMeta.batch||[]).join(','),model:(editMeta.model||[]).join(','),check:(editMeta.check||[]).join(','),scene:(editMeta.scene||[]).join(','),cleaner:(editMeta.cleaner||[]).join(',')})
    }else{
      const fn=saveItemTags;await fn(currentItem.value.id,editTags.value)
    }
    currentItem.value.tags=[...editTags.value]
    if(currentItem.value.metadata){Object.assign(currentItem.value.metadata,{cleanTime:editCleanTime.value,batch:(editMeta.batch||[]).join(','),model:(editMeta.model||[]).join(','),check:(editMeta.check||[]).join(','),sceneStr:(editMeta.scene||[]).join(','),cleaner:(editMeta.cleaner||[]).join(',')})}
    ElMessage.success('已保存');loadAll()
  }catch{}}
function openBatch(){batchTags.value=[];batchVisible.value=true}
async function confirmBatch(){if(!batchTags.value.length){ElMessage.warning('请选择标签');return}
  const isGov=currentDS.value?.source==='gov'
  try{const fn=isGov?batchTagGovernedItems:batchSaveTags;await fn(selectedIds.value,batchTags.value);selectedIds.value.forEach(id=>{const it=browseItems.value.find(i=>i.id===id);if(it)it.tags=[...batchTags.value]});batchVisible.value=false;selectedIds.value=[];ElMessage.success('完成');loadAll()}catch{}}

// 维度
async function openDimEditor(){try{const d=await fetchDim();dimensions.value=d.data||[]}catch{};dimVisible.value=true}
async function onAddDim(){if(!newDim.label.trim()||!newDim.tagsStr.trim()){ElMessage.warning('填写完整');return};try{await saveDim({label:newDim.label.trim(),tags:newDim.tagsStr.split(/[,，]/).map(t=>t.trim()).filter(Boolean)});newDim.label='';newDim.tagsStr='';openDimEditor();ElMessage.success('已添加')}catch{}}
async function onDeleteDim(r){try{await deleteDim(r.id);openDimEditor();ElMessage.success('已删除')}catch{}}

// 导出
async function onDeleteItem(it) {
  try{await ElMessageBox.confirm(`删除「${it.itemName}」？`,'确认删除',{type:'warning'})}catch{return}
  const isGov=currentDS.value?.source==='gov'
  try{
    if(isGov){await deleteGovernedItem(it.id)} else {await deleteTaskItemApi(currentDS.value.taskId||currentDS.value.id, it.id)}
    browseItems.value=browseItems.value.filter(i=>i.id!==it.id);if(currentItem.value?.id===it.id)currentItem.value=null
    ElMessage.success('已删除');loadAll()
  }catch{ElMessage.error('删除失败')}
}

async function removeTag(it, tag) {
  it.tags=(it.tags||[]).filter(t=>t!==tag)
  if(currentItem.value?.id===it.id)editTags.value=editTags.value.filter(t=>t!==tag)
  const isGov=currentDS.value?.source==='gov'
  try{await (isGov?tagGovernedItem:saveItemTags)(it.id, it.tags);loadAll()}catch{}
}

async function onDeleteDS(row) {
  if(row.source!=='gov'){ElMessage.warning('生产数据集请通过项目管理删除');return}
  try{await deleteDataset(row.id);allDatasets.value=allDatasets.value.filter(d=>d.id!==row.id);ElMessage.success('已删除')}catch{ElMessage.error('删除失败')}
}

async function exportDS(row){try{await downloadFile('/datasets/'+(row.taskId||row.id)+'/export','dataset_'+(row.taskId||row.id)+'.json');ElMessage.success('已导出')}catch{ElMessage.error('导出失败')}}

function handleResize(){scenarioChart?.resize()}
onMounted(()=>{initFilterByRole();loadAll();window.addEventListener('resize',handleResize)})
onUnmounted(()=>{window.removeEventListener('resize',handleResize);scenarioChart?.dispose()})
</script>

<style scoped>
.ds-page{--g:12px}
.flow-bar{display:flex;align-items:center;justify-content:center;gap:0;background:#fff;border-radius:8px;padding:16px 20px;margin-bottom:var(--g);box-shadow:0 1px 4px rgba(0,0,0,.06)}
.flow-node{display:flex;align-items:center;gap:6px;padding:10px 20px;border-radius:8px;border:2px solid #ebeef5;font-size:14px;color:#606266;transition:all .2s}
.flow-node.active{border-color:#409eff;background:#ecf5ff;color:#409eff}
.flow-node b{margin-left:4px;font-size:16px}
.flow-arrow{margin:0 8px;color:#c0c4cc;font-size:20px}
.expand-items{padding:8px 0}
.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--g);margin-bottom:var(--g)}
.stat-card{text-align:center}.stat-num{font-size:28px;font-weight:bold}.stat-label{color:#909399;margin-top:6px;font-size:13px}
.panel-head{display:flex;justify-content:space-between;align-items:center}
.ch-sub{font-size:13px;font-weight:600;color:#606266;text-align:center;margin-bottom:4px}
.import-steps{margin-bottom:4px}.file-sel{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f0f9eb;border-radius:4px;margin-top:12px;font-size:13px;color:#67c23a}
.drop-zone{border:2px dashed #dcdfe6;border-radius:8px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s}.drop-zone:hover{border-color:#409eff;background:#f5f7fa}
.browse-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}.browse-count{color:#909399;font-size:13px;flex:1}
.browse-body{display:grid;grid-template-columns:200px 1fr;gap:12px;height:calc(100vh - 180px)}
.browse-list{overflow-y:auto;display:flex;flex-direction:column;gap:6px}
.b-item{display:flex;align-items:flex-start;gap:6px;padding:8px;border:1px solid #ebeef5;border-radius:4px;cursor:pointer;font-size:13px}
.b-item:hover{background:#f5f7fa}.b-item.active{background:#ecf5ff;border-color:#409eff}
.bi-check{margin-top:2px;flex-shrink:0}.bi-info{flex:1;min-width:0}.bi-name{margin-bottom:3px}.bi-tags{display:flex;flex-wrap:wrap;gap:1px}
.browse-main{display:flex;flex-direction:column;gap:12px;min-width:0;overflow-y:auto}
.canvas-box{background:#1f1f1f;border-radius:4px;display:flex;justify-content:center}
.canvas-box canvas{display:block;width:100%;max-width:640px;height:auto}
.ps-title{font-weight:bold;font-size:14px;margin-bottom:10px;border-left:3px solid #409eff;padding-left:8px}
.dim-g{margin-bottom:12px}.dim-l{font-size:13px;font-weight:600;color:#606266;margin-bottom:5px}.dim-t{display:flex;flex-wrap:wrap}
</style>
