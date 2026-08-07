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
              <el-button type="primary" :icon="Upload" size="small" @click="importDialogRef?.open()">导入数据</el-button>
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
                  <el-table-column label="操作" width="80"><template #default="r"><el-button text size="small" type="primary" @click="browseDialogRef?.openSingle(s.row,r.row)">查看</el-button></template></el-table-column>
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
              <el-button text size="small" type="primary" @click="browseDialogRef?.open(s.row)">浏览</el-button>
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




  </div>

  <!-- 导入 / 浏览 -->
  <DatasetImportDialog ref="importDialogRef" @imported="loadAll" />
  <DatasetBrowseDialog ref="browseDialogRef" @changed="loadAll" />
</template>

<script setup>
import { ref,reactive,computed,onMounted,onUnmounted,nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage,ElMessageBox } from 'element-plus'
import { Search,Setting,Upload,Check,UploadFilled,Document,ArrowRight,Download,CircleCheck,Folder } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { fetchDatasets } from '@/api/dataset.js'
import { fetchGovernedDatasets, updateDatasetStatus, deleteDataset } from '@/api/governance.js'
import { useDownload } from '@/composables/useDownload'
import DatasetImportDialog from './components/DatasetImportDialog.vue'
import DatasetBrowseDialog from './components/DatasetBrowseDialog.vue'

const userStore=useUserStore()
const { downloadFile } = useDownload()
const importDialogRef = ref(null)
const browseDialogRef = ref(null)
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
function fmtSize(b){if(!b)return'0 B';const u=['B','KB','MB','GB'];let i=0,s=b;while(s>=1024&&i<3){s/=1024;i++}return s.toFixed(1)+' '+u[i]}

// 状态变更
async function onMarkTagged(row,status){const t=status||'TAGGED';try{await ElMessageBox.confirm(`确认将「${row.name}」标记为「${t}」？`,'状态变更',{type:'warning'})}catch{return};try{await updateDatasetStatus(row.id,t);row.status=t;ElMessage.success('已更新')}catch{}}

// 浏览

// 导出

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
