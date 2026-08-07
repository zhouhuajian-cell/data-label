<template>
  <div class="pm-page">
    <!-- 顶部统计 -->
    <div class="stat-row">
      <el-card v-for="card in statCards" :key="card.key" class="stat-card" shadow="hover">
        <div class="stat-num" :style="{ color: card.color }">{{ card.val }}</div>
        <div class="stat-label">{{ card.label }}</div>
      </el-card>
    </div>

    <div class="pm-body">
      <!-- 左侧：项目列表 -->
      <div class="proj-list-panel">
        <div class="list-toolbar">
          <el-input v-model="searchKey" placeholder="搜索项目名称" clearable :prefix-icon="Search" />
        </div>
        <div class="list-filter">
          <el-radio-group v-model="statusFilter" size="small">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="active">进行中</el-radio-button>
            <el-radio-button value="completed">已完成</el-radio-button>
            <el-radio-button value="paused">已暂停</el-radio-button>
          </el-radio-group>
        </div>

        <div class="proj-cards" v-loading="loading">
          <el-empty v-if="!filteredProjects.length" description="暂无项目" :image-size="60" />
          <div v-for="proj in filteredProjects" :key="proj.id" class="proj-card"
            :class="{ active: selectedId === proj.id, overdue: projectOverdueCount(proj.id) > 0 }"
            @click="selectProject(proj)">
            <div class="pc-head">
              <span class="pc-name" :title="proj.name">{{ proj.name }}</span>
              <el-tag :type="statusTag(proj.status)" size="small">{{ statusMap[proj.status] }}</el-tag>
            </div>
            <div class="pc-client">{{ proj.annotateType }}</div>
            <div class="pc-progress">
              <el-progress :percentage="projectProgress(proj.id)" :stroke-width="8"
                :color="progressColor(projectProgress(proj.id))" />
              <span class="pc-progress-text">{{ projectAcceptedCount[proj.id] || 0 }}/{{ projectTaskCount[proj.id] || 0 }} 已验收</span>
            </div>
            <div class="pc-footer">
              <span class="pc-tasks"><el-icon><List /></el-icon>{{ projectTaskCount[proj.id] || 0 }} 任务</span>
              <el-tag v-if="projectOverdueCount(proj.id)" type="danger" size="small" effect="dark">
                <el-icon><Warning /></el-icon> {{ projectOverdueCount(proj.id) }} 逾期
              </el-tag>
              <el-tag v-else-if="projectActiveCount(proj.id)" type="primary" size="small" effect="plain">
                {{ projectActiveCount(proj.id) }} 进行中
              </el-tag>
            </div>
          </div>
        </div>

        <div class="list-footer">
          <template v-if="isAdminLike">
            <el-button :icon="Upload" @click="openImport" style="flex:1">批量导入</el-button>
            <el-button type="primary" :icon="Plus" @click="openCreate" style="flex:1">新建项目</el-button>
          </template>
          <el-button v-else style="flex:1" disabled>供应商只读视图</el-button>
        </div>
      </div>

      <!-- 右侧：项目工作区 -->
      <div class="proj-detail-panel" v-loading="detailLoading">
        <template v-if="selectedProject">
          <!-- 项目头部 -->
          <el-card class="proj-header" shadow="hover">
            <div class="ph-main">
              <div class="ph-title-row">
                <span class="ph-name">{{ selectedProject.name }}</span>
                <el-tag :type="statusTag(selectedProject.status)">{{ statusMap[selectedProject.status] }}</el-tag>
              </div>
              <el-descriptions :column="3" class="ph-desc" size="small">
                <el-descriptions-item label="标注类型">{{ selectedProject.annotateType }}</el-descriptions-item>
                <el-descriptions-item label="样本量">{{ selectedProject.sampleCount?.toLocaleString() || 0 }}</el-descriptions-item>
                <el-descriptions-item label="截止">{{ selectedProject.deadline }}</el-descriptions-item>
                <el-descriptions-item v-if="selectedProject.template" label="项目模板">{{ selectedProject.template }}</el-descriptions-item>
                <el-descriptions-item v-if="selectedProject.uploadPath" label="数据上传路径">{{ selectedProject.uploadPath }}</el-descriptions-item>
              </el-descriptions>
              <div v-if="selectedProject.description" class="ph-desc-text">{{ selectedProject.description }}</div>
            </div>
            <div class="ph-actions" v-if="isAdminLike">
              <el-button size="small" :icon="Edit" @click="openEditProject(selectedProject)">编辑</el-button>
              <el-select :model-value="selectedProject.status" size="small" style="width:104px" @change="(v) => handleStatusChange(selectedProject, v)">
                <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
              <el-button size="small" type="danger" plain :icon="Delete" @click="deleteProject(selectedProject)">删除</el-button>
              <el-button v-if="selectedProject.status === 'active'" size="small" type="success" :icon="Finished" @click="onArchiveProject">结项归档</el-button>
              <el-button size="small" :icon="Promotion" @click="onPushFeishu">推送飞书</el-button>
            </div>
          </el-card>

          <!-- 任务管理 -->
          <el-card class="task-panel" shadow="never">
            <div class="tp-toolbar">
              <div class="tp-title">任务明细</div>
              <div class="tp-actions">
                <template v-if="isAdminLike">
                  <el-button v-if="selectedTasks.length" size="small" type="warning" plain :icon="Promotion" @click="openBatchDispatch">
                    批量派发 ({{ selectedTasks.length }})
                  </el-button>
                  <el-button size="small" :icon="Upload" @click="openImportTasks(selectedProject)">导入任务</el-button>
                  <el-button size="small" type="primary" plain :icon="Plus" @click="openAddTask(selectedProject)">添加任务</el-button>
                </template>
                <el-button v-if="!isAdminLike" size="small" type="success" :icon="Upload" @click="openDeliverForSelected">提交交付</el-button>
                <el-button v-if="!isAdminLike && selectedTasks.some(t => t.state === 'ACCEPTED')" size="small" type="warning" :icon="Promotion" @click="goSettlement">结算</el-button>
              </div>
            </div>

            <!-- 状态 chips（可点击过滤） -->
            <div class="state-chips">
              <span class="chip" :class="{ active: stateFilter === '' }" @click="stateFilter = ''">
                全部 <b>{{ detailTasks.length }}</b>
              </span>
              <span v-for="chip in stateChips" :key="chip.value" class="chip"
                :class="['chip-' + chip.type, { active: stateFilter === chip.value }]"
                @click="stateFilter = stateFilter === chip.value ? '' : chip.value">
                {{ chip.label }} <b>{{ chip.count }}</b>
              </span>
            </div>

            <el-table :data="filteredDetailTasks" border size="small" row-key="id"
              :row-class-name="taskRowClass"
              @selection-change="onSelectionChange"
              @expand-change="handleExpand">
              <el-table-column type="selection" width="40" :selectable="row => isAdminLike ? ['UNASSIGNED','REJECTED'].includes(row.state) : ['VENDOR_QA','REJECTED','CLIENT_QA','ACCEPTED'].includes(row.state)" />
              <el-table-column type="expand">
                <template #default="scope">
                  <div v-loading="itemsLoading[scope.row.id]" class="items-section">
                    <div class="items-toolbar">
                      <el-tag v-for="(label, code) in ITEM_STATUS_MAP" :key="code" :type="itemStatusTagType(code)" size="small">
                        {{ label }}: {{ itemsByStatus(scope.row.id, code) }}
                      </el-tag>
                      <el-button size="small" type="primary" plain @click="batchUpdateItems(scope.row)">批量已标注</el-button>
                      <el-button size="small" :icon="Upload" @click="openImportItems(scope.row)">导入明细</el-button>
                    </div>
                    <el-table :data="taskItems[scope.row.id] || []" border size="small">
                      <el-table-column label="明细名称" prop="itemName" min-width="150" show-overflow-tooltip />
                      <el-table-column label="场景" width="72"><template #default="is">{{ is.row.metadata?.scene || '-' }}</template></el-table-column>
                      <el-table-column label="城市" width="70"><template #default="is">{{ is.row.metadata?.city || '-' }}</template></el-table-column>
                      <el-table-column label="里程" width="70"><template #default="is">{{ is.row.metadata?.mileage || '-' }}</template></el-table-column>
                      <el-table-column label="车型" width="80"><template #default="is">{{ is.row.metadata?.model || '-' }}</template></el-table-column>
                      <el-table-column label="数据类型" prop="dataType" width="80" />
                      <el-table-column label="标注人" prop="annotator" width="70" />
                      <el-table-column label="标注状态" width="110">
                        <template #default="is">
                          <el-select :model-value="is.row.status" size="small" @change="(v) => updateItemStatus(scope.row.id, is.row, v)">
                            <el-option v-for="(label, code) in ITEM_STATUS_MAP" :key="code" :label="label" :value="code" />
                          </el-select>
                        </template>
                      </el-table-column>
                      <el-table-column label="备注" width="140">
                        <template #default="is">
                          <template v-if="['rejected','failed'].includes(is.row.status)">
                            <el-popover placement="left" :width="280" trigger="click">
                              <template #reference>
                                <el-button size="small" text type="danger">{{ is.row.failReason?.slice(0, 10) || '填写原因' }}</el-button>
                              </template>
                              <el-input v-model="is.row.failReason" type="textarea" :rows="2" placeholder="失败/驳回原因" size="small" />
                              <el-button size="small" type="primary" style="margin-top:8px" @click="saveFailReason(scope.row.id, is.row)">保存</el-button>
                            </el-popover>
                          </template>
                          <span v-else style="color:#c0c4cc">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="数据下载路径" min-width="150" show-overflow-tooltip><template #default="is">{{ is.row.metadata?.downloadPath || '-' }}</template></el-table-column>
                      <el-table-column label="数据上传路径" min-width="170" show-overflow-tooltip><template #default="is">{{ is.row.uploadPath || '-' }}</template></el-table-column>
                      <el-table-column label="操作" width="60">
                        <template #default="is">
                          <el-popconfirm title="确定删除？" @confirm="deleteItem(scope.row.id, is.row)">
                            <template #reference><el-button size="small" text type="danger">删除</el-button></template>
                          </el-popconfirm>
                        </template>
                      </el-table-column>
                    </el-table>
                    <el-empty v-if="!taskItems[scope.row.id]?.length" description="暂无明细" :image-size="40" />
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="任务名称" prop="taskName" min-width="150" show-overflow-tooltip>
                <template #default="scope">
                  <span class="task-name-cell">
                    <el-icon v-if="isOverdue(scope.row)" color="#f56c6c" :title="'已逾期'"><Warning /></el-icon>
                    {{ scope.row.taskName }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="类型" prop="annotateType" width="105" />
              <el-table-column label="样本量" prop="sampleCount" width="72" />
              <el-table-column label="单价" width="66"><template #default="s">¥{{ s.row.unitPrice }}</template></el-table-column>
              <el-table-column label="供应商" prop="supplierName" width="96">
                <template #default="scope">{{ scope.row.supplierName || '-' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="88">
                <template #default="scope">
                  <el-tag :type="getStateType(scope.row.state)" size="small">{{ getStateText(scope.row.state) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="截止" prop="deadline" width="130">
                <template #default="scope">
                  <span :style="{ color: isOverdue(scope.row) ? '#f56c6c' : 'inherit' }">{{ scope.row.deadline }}</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="280" fixed="right">
                <template #default="scope">
                  <el-button text size="small" type="primary" @click="$router.push('/task/detail/' + scope.row.id)">详情</el-button>
                  <el-button v-if="isAdminLike" text size="small" type="primary" @click="openUploadPackage(scope.row)">导入数据包</el-button>
                  <el-button v-if="!isAdminLike && scope.row.dataPackage" text size="small" type="primary" @click="downloadTaskPackage(scope.row)">下载数据包</el-button>
                  <el-button v-if="isAdminLike && ['UNASSIGNED','REJECTED'].includes(scope.row.state)" text size="small" type="primary" @click="dispatchSingle(scope.row)">派发</el-button>
                  <el-button v-if="isAdminLike && scope.row.state === 'CLIENT_QA'" text size="small" type="success" @click="reviewSingle(scope.row)">验收</el-button>
                  <el-button v-if="['CLIENT_QA','ACCEPTED'].includes(scope.row.state)" text size="small" type="primary" @click="downloadSubmission(scope.row)">下载成果</el-button>
                  <el-button v-if="['ACCEPTED','ARCHIVED'].includes(scope.row.state)" text size="small" type="warning" @click="$router.push('/finance/bill')">结算</el-button>
                  <el-button v-if="!isAdminLike && ['VENDOR_QA','REJECTED'].includes(scope.row.state)" text size="small" type="success" @click="$router.push('/task/detail/' + scope.row.id)">提交</el-button>
                  <el-dropdown v-if="isAdminLike" trigger="click" @command="(cmd) => handleTaskCommand(cmd, scope.row)">
                    <el-button text size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="workbench" v-if="scope.row.annotateType === '2D拉框' && ['ANNOTATING','VENDOR_QA','CLIENT_QA'].includes(scope.row.state)">进入工作台</el-dropdown-item>
                        <el-dropdown-item command="edit" v-if="scope.row.state === 'UNASSIGNED'">编辑任务</el-dropdown-item>
                        <el-dropdown-item command="dispatch" v-if="['UNASSIGNED','REJECTED'].includes(scope.row.state)">派发任务</el-dropdown-item>
                        <el-dropdown-item command="delete" v-if="scope.row.state === 'UNASSIGNED'" divided>删除任务</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
              <template #empty>
                <span style="color:#c0c4cc">暂无任务</span>
              </template>
            </el-table>
          </el-card>
        </template>
        <el-empty v-else description="请选择左侧项目查看详情" :image-size="120" style="margin-top:120px" />
      </div>
    </div>

    <!-- 新建项目：分步向导 -->
    <el-dialog v-model="createVisible" title="新建项目并派发" width="860px" :close-on-click-modal="false" @closed="resetCreate">
      <el-steps :active="createStep" align-center finish-status="success" class="create-steps">
        <el-step title="项目信息" />
        <el-step title="任务明细" />
        <el-step title="派发设置" />
      </el-steps>

      <!-- 步骤1：项目信息 -->
      <el-form v-show="createStep === 0" ref="step1FormRef" :model="createForm" :rules="createProjectRules" label-width="90px" style="margin-top:20px">
        <el-form-item label="项目名称" prop="name"><el-input v-model="createForm.name" placeholder="请输入项目名称" /></el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="标注类型" prop="annotateType">
              <el-select v-model="createForm.annotateType" placeholder="选择类型" style="width:100%">
                <el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="截止时间"><el-date-picker v-model="createForm.deadline" type="date" style="width:100%" value-format="YYYY-MM-DD" /></el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="项目描述"><el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="项目描述（选填）" /></el-form-item>
        <el-form-item label="项目模板"><el-input v-model="createForm.template" placeholder="标注模板/模板说明（选填）" /></el-form-item>
        <el-form-item label="数据上传路径"><el-input v-model="createForm.uploadPath" placeholder="数据上传路径（选填）" /></el-form-item>
        <el-form-item label="绑定数据集">
          <el-radio-group v-model="createForm.bindMode" size="small" style="margin-bottom:8px">
            <el-radio-button value="select">选择已有</el-radio-button>
            <el-radio-button value="upload">上传新数据</el-radio-button>
          </el-radio-group>
          <el-select v-if="createForm.bindMode==='select'" v-model="createForm.datasetId" placeholder="选择清洗数据集" clearable style="width:100%" @focus="loadGovernanceDatasets">
            <el-option v-for="ds in governanceDatasets" :key="ds.id" :label="ds.name + ' | ' + ds.itemCount + '条'" :value="ds.id" />
          </el-select>
          <div v-else class="upload-row">
            <el-upload drag :auto-upload="false" :on-change="onProjectFileChange" :limit="1" accept=".zip,.csv,.xlsx,.json,.jsonl" style="width:100%">
              <el-icon size="32"><UploadFilled /></el-icon>
              <div class="el-upload__text">拖拽数据包或<em>点击上传</em></div>
              <template #tip><div class="el-upload__tip">支持 zip / csv / xlsx / json</div></template>
            </el-upload>
            <div v-if="uploadForm.fileName" class="file-sel" style="margin-top:8px;padding:8px 12px;background:#f0f9eb;border-radius:4px;font-size:13px;color:#67c23a;display:flex;align-items:center;gap:6px">
              <el-icon><Document /></el-icon>已选择：{{ uploadForm.fileName }}（{{ fmtSize(uploadForm.fileSize) }}）
            </div>
            <el-input v-if="uploadForm.fileName" v-model="uploadForm.datasetName" placeholder="数据集名称" style="margin-top:8px" />
            <el-input-number v-if="uploadForm.fileName" v-model="uploadForm.itemCount" :min="1" :max="500" style="margin-top:8px;width:100%" />
          </div>
        </el-form-item>
      </el-form>

      <!-- 步骤2：任务明细 -->
      <div v-show="createStep === 1" style="margin-top:20px">
        <div class="step2-toolbar">
          <span class="step2-tip">为项目添加任务（至少 1 个）</span>
          <el-button size="small" type="primary" text :icon="Plus" @click="addTaskRow">手动添加</el-button>
          <el-button v-if="createForm.bindMode==='select' && createForm.datasetId" size="small" type="success" :icon="Connection" @click="autoSplitTasks">自动拆分</el-button>
          <el-upload :show-file-list="false" :auto-upload="false" :on-change="onTaskExcelImport" accept=".xlsx,.xls,.csv" style="display:inline-flex">
            <el-button size="small" type="warning" text :icon="Upload">导入Excel</el-button>
          </el-upload>
        </div>
        <el-table :data="createForm.tasks" border size="small" max-height="300">
          <el-table-column label="任务名称" min-width="150"><template #default="s"><el-input v-model="s.row.taskName" placeholder="任务名称" size="small" /></template></el-table-column>
          <el-table-column label="数据上传路径" min-width="150"><template #default="s"><el-input v-model="s.row.uploadPath" placeholder="数据上传路径" size="small" /></template></el-table-column>
          <el-table-column label="类型" width="115"><template #default="s"><el-select v-model="s.row.annotateType" size="small"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select></template></el-table-column>
          <el-table-column label="样本量" width="85"><template #default="s"><el-input-number v-model="s.row.sampleCount" :min="0" size="small" controls-position="right" style="width:75px" /></template></el-table-column>
          <el-table-column label="单价" width="80"><template #default="s"><el-input-number v-model="s.row.unitPrice" :min="0" :step="0.05" :precision="2" size="small" controls-position="right" style="width:70px" /></template></el-table-column>
          <el-table-column label="截止" width="125"><template #default="s"><el-date-picker v-model="s.row.deadline" type="date" size="small" style="width:115px" value-format="YYYY-MM-DD" /></template></el-table-column>
          <el-table-column label="操作" width="55"><template #default="s"><el-button text size="small" type="danger" :icon="Delete" @click="removeTaskRow(s.$index)" /></template></el-table-column>
        </el-table>
        <div class="create-total">合计 {{ createForm.tasks.length }} 个任务 · 预估总额 ¥{{ createTotalPrice }}</div>
      </div>

      <!-- 步骤3：派发设置 -->
      <div v-show="createStep === 2" style="margin-top:20px">
        <el-alert type="info" :closable="false" style="margin-bottom:16px">
          <template #title>将为项目创建 {{ createForm.tasks.filter(t=>t.taskName.trim()).length }} 个任务{{ createForm.supplierId ? '，并派发给所选供应商' : '（暂不派发，创建后可再派发）' }}</template>
        </el-alert>
        <el-form label-width="90px">
          <el-form-item label="供应商">
            <el-select v-model="createForm.supplierId" placeholder="选择供应商（可跳过）" clearable style="width:100%" @focus="loadSuppliers">
              <el-option v-for="s in supplierList" :key="s.id" :label="s.name + ' | 质量分' + s.qualityScore" :value="s.id" />
            </el-select>
          </el-form-item>
          <div v-if="createSelectedSupplier" class="supplier-info">
            <div class="si-row"><span>供应商</span><b>{{ createSelectedSupplier.name }}</b></div>
            <div class="si-row"><span>联系人</span>{{ createSelectedSupplier.contact }}</div>
            <div class="si-row"><span>产能(条/月)</span>{{ createSelectedSupplier.capacity?.toLocaleString() }}</div>
            <div class="si-row"><span>质量分</span><b :style="{color: createSelectedSupplier.qualityScore >= 90 ? '#67c23a' : '#e6a23c'}">{{ createSelectedSupplier.qualityScore }}</b></div>
          </div>
          <el-form-item label="立即开工" style="margin-top:12px">
            <el-switch v-model="createForm.immediateStart" active-text="派发后直接进入标注" />
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button v-if="createStep > 0" @click="createStep--">上一步</el-button>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button v-if="createStep < 2" type="primary" @click="nextStep">下一步</el-button>
        <el-button v-else type="primary" :loading="actionLoading" @click="submitCreate">创建项目</el-button>
      </template>
    </el-dialog>

    <!-- 编辑项目 -->
    <el-dialog v-model="editProjectVisible" title="编辑项目" width="600px">
      <el-form ref="editProjectFormRef" :model="editProjectForm" :rules="editProjectRules" label-width="90px">
        <el-form-item label="项目名称" prop="name"><el-input v-model="editProjectForm.name" /></el-form-item>
        <el-form-item label="标注类型" prop="annotateType">
          <el-select v-model="editProjectForm.annotateType" style="width:100%"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select>
        </el-form-item>
        <el-form-item label="截止时间"><el-date-picker v-model="editProjectForm.deadline" type="date" style="width:100%" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="项目描述"><el-input v-model="editProjectForm.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="项目模板"><el-input v-model="editProjectForm.template" placeholder="标注模板/模板说明（选填）" /></el-form-item>
        <el-form-item label="数据上传路径"><el-input v-model="editProjectForm.uploadPath" placeholder="数据上传路径（选填）" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editProjectVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitEditProject">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入任务 -->
    <el-dialog v-model="importTasksVisible" title="一键导入任务" width="750px" @closed="resetImportTasks">
      <el-tabs v-model="importTab">
        <el-tab-pane label="上传文件" name="file">
          <div class="import-header"><span style="color:#909399;font-size:13px">支持 CSV/TXT</span><el-button size="small" text type="primary" @click="downloadTaskTemplate">下载CSV模板</el-button></div>
          <el-upload drag :limit="1" :auto-upload="false" :on-change="handleImportFile" :file-list="importFileList" accept=".csv,.txt">
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽文件或<em>点击上传</em></div>
          </el-upload>
        </el-tab-pane>
        <el-tab-pane label="粘贴数据" name="text">
          <el-alert type="info" :closable="false" style="margin-bottom:12px"><template #title>任务名称,标注类型,样本数量,截止时间,标注规范</template></el-alert>
          <el-input v-model="importTasksText" type="textarea" :rows="10" placeholder="示例-点云,ND001,3D点云标注,10000,2026-09-30," />
          <el-button style="margin-top:12px" type="primary" :disabled="!importTasksText.trim()" @click="parseImportTasksText">解析数据</el-button>
        </el-tab-pane>
      </el-tabs>
      <template v-if="importPreview.length">
        <div class="import-preview">
          <p>共 <b>{{ importPreview.length }}</b> 条</p>
          <el-table :data="importPreview" border max-height="260" size="small">
            <el-table-column label="任务名称" prop="taskName" />
            <el-table-column label="标注类型" prop="annotateType" width="110" />
            <el-table-column label="样本量" prop="sampleCount" width="80" />
            <el-table-column label="截止" prop="deadline" width="110" />
          </el-table>
          <div class="import-actions">
            <el-button @click="resetImportTasks">重选</el-button>
            <el-button type="primary" :loading="actionLoading" @click="submitImportTasks">一键导入</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 编辑任务 -->
    <el-dialog v-model="editTaskVisible" title="编辑任务" width="560px">
      <el-form ref="editTaskFormRef" :model="editTaskForm" :rules="editTaskRules" label-width="100px">
        <el-form-item label="任务名称" prop="taskName"><el-input v-model="editTaskForm.taskName" /></el-form-item>
        <el-form-item label="标注类型" prop="annotateType"><el-select v-model="editTaskForm.annotateType" style="width:100%"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select></el-form-item>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="样本数量"><el-input-number v-model="editTaskForm.sampleCount" :min="1" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="单价"><el-input-number v-model="editTaskForm.unitPrice" :min="0" :step="0.05" :precision="2" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="截止时间"><el-date-picker v-model="editTaskForm.deadline" type="datetime" style="width:100%" value-format="YYYY-MM-DD HH:mm" /></el-form-item>
        <el-form-item label="标注规范"><el-input v-model="editTaskForm.qaStandard" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editTaskVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitEditTask">保存</el-button>
      </template>
    </el-dialog>

    <!-- 派发（单条/批量） -->
    <el-dialog v-model="dispatchTaskVisible" :title="dispatchForm.taskIds.length > 1 ? '批量派发任务' : '派发任务'" width="500px">
      <el-form ref="dispatchTaskFormRef" :model="dispatchForm" :rules="{ supplierId: [{ required: true, message: '请选择供应商', trigger: 'change' }] }" label-width="80px">
        <el-form-item label="任务">
          <span v-if="dispatchForm.taskIds.length === 1">{{ dispatchForm.taskName }}</span>
          <el-tag v-else type="warning">已选 {{ dispatchForm.taskIds.length }} 个任务</el-tag>
        </el-form-item>
        <el-form-item label="供应商" prop="supplierId">
          <el-select v-model="dispatchForm.supplierId" placeholder="选择供应商" style="width:100%" @focus="loadSuppliers">
            <el-option v-for="s in supplierList" :key="s.id" :label="s.name + ' | 质量分' + s.qualityScore" :value="s.id" />
          </el-select>
        </el-form-item>
        <div v-if="dispatchSelectedSupplier" class="supplier-info">
          <div class="si-row"><span>供应商</span><b>{{ dispatchSelectedSupplier.name }}</b></div>
          <div class="si-row"><span>联系人</span>{{ dispatchSelectedSupplier.contact }}</div>
          <div class="si-row"><span>产能(条/月)</span>{{ dispatchSelectedSupplier.capacity?.toLocaleString() }}</div>
          <div class="si-row"><span>质量分</span><b :style="{color: dispatchSelectedSupplier.qualityScore >= 90 ? '#67c23a' : '#e6a23c'}">{{ dispatchSelectedSupplier.qualityScore }}</b></div>
          <div class="si-row"><span>在执任务</span>{{ dispatchSelectedSupplier.activeTaskCount }}</div>
        </div>
        <el-form-item label="立即开工" style="margin-top:12px">
          <el-switch v-model="dispatchForm.immediateStart" active-text="派发后直接进入标注" />
        </el-form-item>
        <el-form-item label="QA抽检率">
          <el-slider v-model="dispatchForm.qaSamplingRate" :min="0.1" :max="1" :step="0.1" :format-tooltip="(v) => (v*100).toFixed(0) + '%'" style="width:100%" />
          <span style="color:#909399;font-size:12px">{{ (dispatchForm.qaSamplingRate * 100).toFixed(0) }}%（未抽中的自动通过）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispatchTaskVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="confirmDispatch">确认派发</el-button>
      </template>
    </el-dialog>

    <!-- 验收 -->
    <el-dialog v-model="reviewTaskVisible" title="验收" width="480px">
      <el-form ref="reviewFormRef" :model="reviewForm" :rules="reviewRules" label-width="90px">
        <el-form-item label="任务">{{ reviewForm.taskName }}</el-form-item>
        <el-form-item label="结果" prop="pass">
          <el-radio-group v-model="reviewForm.pass"><el-radio-button :value="true">通过</el-radio-button><el-radio-button :value="false">驳回</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item label="分数" prop="score"><el-input-number v-model="reviewForm.score" :min="0" :max="100" style="width:100%" /></el-form-item>
        <el-form-item label="意见" prop="comment"><el-input v-model="reviewForm.comment" type="textarea" :rows="2" :placeholder="reviewForm.pass ? '选填' : '驳回原因必填（至少5字）'" /></el-form-item>
        <el-form-item v-if="!reviewForm.pass" label="驳回分类" prop="rejectReason">
          <el-select v-model="reviewForm.rejectReason" placeholder="选择驳回原因" style="width:100%">
            <el-option v-for="t in REJECT_ERROR_TYPES" :key="t.value" :label="t.label" :value="t.label" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewTaskVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="confirmReview">提交</el-button>
      </template>
    </el-dialog>

    <!-- 添加任务 -->
    <el-dialog v-model="addTaskVisible" title="添加任务" width="560px" @closed="addTaskFormRef?.resetFields()">
      <el-form ref="addTaskFormRef" :model="addTaskForm" :rules="addTaskRules" label-width="110px">
        <el-form-item label="任务名称" prop="taskName"><el-input v-model="addTaskForm.taskName" placeholder="如：Batch02-路口场景" /></el-form-item>
        <el-form-item label="数据上传路径" prop="uploadPath"><el-input v-model="addTaskForm.uploadPath" placeholder="请输入数据上传路径" /></el-form-item>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="标注类型" prop="annotateType"><el-select v-model="addTaskForm.annotateType" style="width:100%"><el-option v-for="t in annotateTypes" :key="t" :label="t" :value="t" /></el-select></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="单价"><el-input-number v-model="addTaskForm.unitPrice" :min="0" :step="0.05" :precision="2" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="样本数量"><el-input-number v-model="addTaskForm.sampleCount" :min="0" style="width:100%" /></el-form-item>
        <el-form-item label="截止时间"><el-date-picker v-model="addTaskForm.deadline" type="datetime" style="width:100%" value-format="YYYY-MM-DD HH:mm" /></el-form-item>
        <el-form-item label="标注规范"><el-input v-model="addTaskForm.qaStandard" type="textarea" :rows="2" placeholder="标注规范要求" /></el-form-item>
        <el-form-item label="数据包"><el-upload :auto-upload="false" :limit="1" :on-change="onAddTaskFileChange" accept=".zip,.tar,.gz,.7z"><el-button size="small" :icon="Upload">{{ addTaskFile ? addTaskFile.name : '选择数据包' }}</el-button></el-upload></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addTaskVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="submitAddTask">确认添加</el-button>
      </template>
    </el-dialog>

    <!-- 数据包上传 -->
    <input ref="pkgInputRef" type="file" accept=".zip,.tar,.gz,.7z" style="display:none" @change="onPkgInputChange" />

    <!-- 导入明细 -->
    <el-dialog v-model="importItemsVisible" title="导入明细" width="650px" @closed="importItemsText='';importItemsPreview=[];importItemsFileList=[]">
      <div style="margin-bottom:12px;font-size:13px;color:#606266" v-if="currentImportTaskName">
        导入到：<b>{{ currentImportTaskName }}</b>
      </div>
      <el-tabs>
        <el-tab-pane label="上传文件" name="file">
          <div class="import-header"><span style="color:#909399;font-size:13px">支持CSV/TXT文件</span><el-button size="small" text type="primary" @click="downloadItemsTemplate">下载模板</el-button></div>
           <el-upload drag :limit="1" :auto-upload="false" :on-change="handleImportItemsFile" :file-list="importItemsFileList" accept=".csv,.txt,.xlsx,.xls">
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽CSV文件或<em>点击上传</em></div>
          </el-upload>
        </el-tab-pane>
        <el-tab-pane label="粘贴数据" name="text">
          <el-input v-model="importItemsText" type="textarea" :rows="8" placeholder="明细名称,数据类型,标注人,标注状态,备注,数据上传路径&#10;样本-001,图像,张三,annotated,,/data/upload/a&#10;样本-002,点云,李四,pending,,/data/upload/b" />
          <el-button style="margin-top:12px" type="primary" :disabled="!importItemsText.trim()" @click="importItemsPreview=parseItemsLines(importItemsText)">解析</el-button>
        </el-tab-pane>
      </el-tabs>
      <template v-if="importItemsPreview.length">
        <div class="import-preview"><p>共 <b>{{ importItemsPreview.length }}</b> 条</p>
          <el-table :data="importItemsPreview" border max-height="260" size="small">
            <el-table-column label="明细名称" prop="itemName" />
            <el-table-column label="数据类型" prop="dataType" width="80" />
            <el-table-column label="标注人" prop="annotator" width="80" />
            <el-table-column label="标注状态" width="90"><template #default="s">{{ ITEM_STATUS_MAP[s.row.status] || s.row.status }}</template></el-table-column>
            <el-table-column label="备注" prop="failReason" width="120" />
            <el-table-column label="数据上传路径" prop="uploadPath" min-width="150" show-overflow-tooltip />
          </el-table>
          <div class="import-actions"><el-button @click="importItemsPreview=[];importItemsFileList=[]">重选</el-button><el-button type="primary" :loading="actionLoading" @click="submitImportItems">导入</el-button></div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, Search, Plus, Upload, Edit, Delete, ArrowDown, List, Warning, Promotion, Connection, Finished } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { getProjectsApi, createProjectApi, updateProjectStatusApi, updateProjectApi, deleteProjectApi, importProjectsApi, importProjectTasksApi, splitProjectApi, importProjectTasksFileApi, archiveProjectApi, parseProjectExcelApi } from '@/api/projects'
import { getSupplierListApi, createTaskApi, dispatchTaskApi, reviewTaskApi, updateTaskApi, deleteTaskApi, getTaskListApi, getTaskDetailApi } from '@/api/tasks'
import { getTaskItemsApi, updateTaskItemApi, deleteTaskItemApi, batchUpdateTaskItemsApi, importTaskItemsApi, importTaskItemsFileApi, uploadTaskPackageApi } from '@/api/items'
import { fetchGovernedDatasets, importDataset, previewSplitApi } from '@/api/governance'
import { pushProjectSummaryApi } from '@/api/feishu'
import { useDownload } from '@/composables/useDownload'
import { getTaskStateText as getStateText, getTaskStateType as getStateType, REJECT_ERROR_TYPES, ITEM_STATUS_MAP } from '@/utils/constants'
import { parseTaskLines, parseItemsLines } from '@/utils/csv'

const router = useRouter()
const userStore = useUserStore()
const { downloadFile } = useDownload()
const isAdminLike = computed(() => [1, 7].includes(userStore.userInfo.roleType))
const loading = ref(false)
const detailLoading = ref(false)
const actionLoading = ref(false)
const projectList = ref([])
const selectedId = ref(null)
const projectTasks = reactive({})
const projectTaskCount = reactive({})
const projectAcceptedCount = reactive({})
const projectActiveCountMap = reactive({})
const projectOverdueCountMap = reactive({})
const taskItems = reactive({})
const itemsLoading = reactive({})

const currentImportTaskName = computed(() => {
  if (!importingTaskId.value) return null
  const t = (projectTasks[selectedId.value] || []).find(t => t.id === importingTaskId.value)
  return t ? t.taskName + ' (ID:' + t.id + ')' : null
})
const supplierList = ref([])
const governanceDatasets = ref([])
const selectedTasks = ref([])
const expandedTaskId = ref(null)
const dialogTaskOptions = ref([])

const searchKey = ref('')
const statusFilter = ref('')
const stateFilter = ref('')

const itemStatusTagType = (code) => (['failed', 'rejected'].includes(code) ? 'danger' : code === 'annotated' ? 'success' : code === 'pending' ? 'info' : '')

const annotateTypes = ['2D拉框', '3D点云标注', '语义分割', '车道线标注', 'Vslam', '数据闭环', 'CNN', 'AEB', 'OBJ']
const statusOptions = [
  { label: '进行中', value: 'active' }, { label: '已完成', value: 'completed' },
  { label: '已暂停', value: 'paused' }, { label: '已归档', value: 'archived' }
]
const statusMap = { active: '进行中', completed: '已完成', paused: '已暂停', archived: '已归档' }
const statusTag = (s) => ({ active: '', completed: 'success', paused: 'warning', archived: 'info' }[s] || '')
const progressColor = (p) => (p >= 80 ? '#67c23a' : p >= 40 ? '#e6a23c' : '#409eff')

// 统计卡片
const statCards = computed(() => {
  const active = projectList.value.filter(p => p.status === 'active').length
  const completed = projectList.value.filter(p => p.status === 'completed').length
  const totalSamples = projectList.value.reduce((a, p) => a + (p.sampleCount || 0), 0)
  return [
    { key: 'projects', val: projectList.value.length, label: '项目总数', color: '#409eff' },
    { key: 'active', val: active, label: '进行中', color: '#67c23a' },
    { key: 'completed', val: completed, label: '已完成', color: '#909399' },
    { key: 'samples', val: totalSamples.toLocaleString(), label: '样本总量', color: '#e6a23c' }
  ]
})

const filteredProjects = computed(() => {
  let list = projectList.value
  if (statusFilter.value) list = list.filter(p => p.status === statusFilter.value)
  if (searchKey.value.trim()) {
    const k = searchKey.value.trim().toLowerCase()
    list = list.filter(p => p.name.toLowerCase().includes(k))
  }
  return list
})

const selectedProject = computed(() => projectList.value.find(p => p.id === selectedId.value))
const detailTasks = computed(() => projectTasks[selectedId.value] || [])

const filteredDetailTasks = computed(() => {
  if (!stateFilter.value) return detailTasks.value
  return detailTasks.value.filter(t => t.state === stateFilter.value)
})

// 任务状态 chips
const stateChips = computed(() => {
  const map = {}
  detailTasks.value.forEach(t => { map[t.state] = (map[t.state] || 0) + 1 })
  const order = [
    { value: 'UNASSIGNED', label: '待指派', type: 'warning' },
    { value: 'ANNOTATING', label: '标注中', type: 'primary' },
    { value: 'VENDOR_QA', label: '供应商质检', type: 'warning' },
    { value: 'CLIENT_QA', label: '甲方质检', type: 'primary' },
    { value: 'ACCEPTED', label: '已验收', type: 'success' },
    { value: 'REJECTED', label: '驳回', type: 'danger' }
  ]
  return order.filter(o => map[o.value]).map(o => ({ ...o, count: map[o.value] }))
})

const projectProgress = (projectId) => {
  const total = projectTaskCount[projectId] || 0
  return total ? Math.round((projectAcceptedCount[projectId] || 0) / total * 100) : 0
}
const projectOverdueCount = (projectId) => projectOverdueCountMap[projectId] || 0
const projectActiveCount = (projectId) => projectActiveCountMap[projectId] || 0

const isOverdue = (task) => {
  if (!task.deadline || ['ACCEPTED', 'ARCHIVED'].includes(task.state)) return false
  return new Date(task.deadline.replace(/-/g, '/')).getTime() < Date.now()
}

const taskRowClass = ({ row }) => (isOverdue(row) ? 'row-overdue' : '')

function selectProject(proj) {
  selectedId.value = proj.id
  stateFilter.value = ''
  selectedTasks.value = []
  loadProjectTasks(proj.id)
}

// ===== 新建项目（分步向导） =====
const createVisible = ref(false)
const createStep = ref(0)
const step1FormRef = ref(null)
const createForm = reactive({ name: '', annotateType: '', deadline: '', description: '', template: '', uploadPath: '', datasetId: null, bindMode: 'select', supplierId: null, immediateStart: true, tasks: [] })
const uploadForm = reactive({ fileName: '', fileSize: 0, datasetName: '', itemCount: 30 })
const createProjectRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }]
}
const createTotalPrice = computed(() => createForm.tasks.reduce((sum, t) => sum + (t.sampleCount || 0) * (t.unitPrice || 0), 0).toFixed(2))
const createSelectedSupplier = computed(() => supplierList.value.find(s => s.id === createForm.supplierId))

const addTaskRow = () => createForm.tasks.push({ taskName: '', uploadPath: createForm.uploadPath || '', annotateType: createForm.annotateType || '2D拉框', sampleCount: 0, unitPrice: 0.1, deadline: createForm.deadline || '', qaStandard: '' })
const removeTaskRow = (i) => createForm.tasks.splice(i, 1)

const resetCreate = () => {
  createStep.value = 0
  step1FormRef.value?.resetFields()
  Object.assign(createForm, { name: '', annotateType: '', deadline: '', description: '', template: '', uploadPath: '', datasetId: null, bindMode: 'select', supplierId: null, immediateStart: true, tasks: [] })
  Object.assign(uploadForm, { fileName: '', fileSize: 0, datasetName: '', itemCount: 30 })
}

const openCreate = () => { resetCreate(); addTaskRow(); createVisible.value = true }

const nextStep = async () => {
  if (createStep.value === 0) {
    try { await step1FormRef.value.validate() } catch { return }
  }
  if (createStep.value === 1) {
    const valid = createForm.tasks.filter(t => t.taskName.trim())
    if (!valid.length && !createForm.datasetId) { ElMessage.warning('请至少添加一个任务或绑定数据集并自动拆分'); return }
    const missing = valid.filter(t => !(t.uploadPath || '').trim())
    if (missing.length) { ElMessage.warning(`还有 ${missing.length} 个任务未填写数据上传路径`); return }
  }
  createStep.value++
}

const submitCreate = async () => {
  const validTasks = createForm.tasks.filter(t => t.taskName.trim())
  if (!validTasks.length && !createForm.datasetId && createForm.bindMode !== 'upload') { ElMessage.warning('请至少添加一个任务或绑定数据集'); return }
  if (createForm.bindMode === 'upload' && !uploadForm.fileName) { ElMessage.warning('请选择要上传的数据文件'); return }
  actionLoading.value = true
  try {
    let finalDatasetId = createForm.datasetId
    // 上传模式：先导入数据生成数据集
    if (createForm.bindMode === 'upload') {
      const { data: ds } = await importDataset({ name: uploadForm.datasetName || createForm.name + '_data', fileName: uploadForm.fileName, fileSize: uploadForm.fileSize, itemCount: uploadForm.itemCount })
      finalDatasetId = ds.id
      ElMessage.success('数据已导入，生成数据集 ' + ds.name)
    }
    const { data: project } = await createProjectApi({
      name: createForm.name, annotateType: createForm.annotateType,
      deadline: createForm.deadline, description: createForm.description,
      template: createForm.template, uploadPath: createForm.uploadPath,
      datasetId: finalDatasetId
    })
    let dispatched = 0
    // 如果绑定了数据集 → 调用拆分 API（自动创建任务+复制数据）
    if (createForm.datasetId) {
      const splitJson = await splitProjectApi(project.id, { itemsPerTask: 10 })
      if (splitJson.code === 0) {
        const createdTasks = splitJson.data.tasks || []
        ElMessage.success(`项目创建成功，自动拆分 ${createdTasks.length} 个任务，共 ${splitJson.data.totalItems} 条数据` + (createForm.supplierId ? '' : ''))
        // 派发
        if (createForm.supplierId) {
          for (const t of createdTasks) {
            await dispatchTaskApi(t.id, { supplierId: createForm.supplierId, immediateStart: createForm.immediateStart })
            dispatched++
          }
        }
      }
    } else {
      // 手动添加的任务
      for (const task of validTasks) {
        const { data: t } = await createTaskApi({ ...task, projectId: project.id })
        if (createForm.supplierId) {
          await dispatchTaskApi(t.id, { supplierId: createForm.supplierId, immediateStart: createForm.immediateStart })
          dispatched++
        }
      }
      ElMessage.success(`项目创建成功，共 ${validTasks.length} 条任务` + (dispatched ? `，已派发 ${dispatched} 条` : ''))
    }
    createVisible.value = false
    loadProjects()
  } finally { actionLoading.value = false }
}

// ===== 编辑项目 =====
const editProjectVisible = ref(false)
const editProjectFormRef = ref(null)
const editProjectForm = reactive({ id: null, name: '', annotateType: '', deadline: '', description: '', template: '', uploadPath: '' })
const editProjectRules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }]
}
const openEditProject = (proj) => {
  Object.assign(editProjectForm, { id: proj.id, name: proj.name, annotateType: proj.annotateType, deadline: proj.deadline === '-' ? '' : proj.deadline, description: proj.description, template: proj.template || '', uploadPath: proj.uploadPath || '' })
  editProjectVisible.value = true
}
const submitEditProject = async () => {
  try { await editProjectFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    await updateProjectApi(editProjectForm.id, editProjectForm)
    ElMessage.success('项目已更新')
    editProjectVisible.value = false
    loadProjects()
  } finally { actionLoading.value = false }
}

// ===== 导入任务 =====
const importTasksVisible = ref(false)
const importingProjectId = ref(null)
const importTab = ref('file')
const importTasksText = ref('')
const importFileList = ref([])
const importPreview = ref([])
const resetImportTasks = () => { importTasksText.value = ''; importFileList.value = []; importPreview.value = [] }
const handleImportFile = (file) => {
  const raw = file.raw || file
  importFileList.value = [file]
  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1]
    try {
      const json = await importProjectTasksFileApi(importingProjectId.value, { fileName: raw.name, fileData: base64 })
      ElMessage.success(`导入 ${json.data.imported} 条任务`)
      importTasksVisible.value = false
      loadProjectTasks(importingProjectId.value)
    } catch { ElMessage.error('导入失败') }
  }
  reader.readAsDataURL(raw)
}
const parseImportTasksText = () => { importPreview.value = parseTaskLines(importTasksText.value) }
const downloadTaskTemplate = () => {
  const BOM = '\uFEFF'
  const content = BOM + '任务名称,标注类型,样本数量,截止时间,标注规范\n示例-点云,3D点云标注,10000,2026-09-30,\n示例-2D框,2D拉框,5000,2026-10-15,'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = '任务导入模板.csv'; a.click()
  URL.revokeObjectURL(url)
}
const openImportTasks = (proj) => { resetImportTasks(); importingProjectId.value = proj.id; importTab.value = 'file'; importTasksVisible.value = true }
const submitImportTasks = async () => {
  if (!importPreview.value.length) return
  actionLoading.value = true
  try {
    const { data } = await importProjectTasksApi(importingProjectId.value, importPreview.value)
    ElMessage.success(`导入 ${data.imported} 条任务`)
    importTasksVisible.value = false
    loadProjectTasks(importingProjectId.value)
  } finally { actionLoading.value = false }
}

// ===== 添加任务 =====
const editingProjectId = ref(null)
const addTaskVisible = ref(false)
const addTaskFormRef = ref(null)
const addTaskFile = ref(null)
const addTaskForm = reactive({ taskName: '', uploadPath: '', annotateType: '', sampleCount: null, unitPrice: 0.1, deadline: '', qaStandard: '' })
const addTaskRules = { taskName: [{ required: true, message: '请输入任务名称', trigger: 'blur' }], annotateType: [{ required: true, message: '请选择标注类型', trigger: 'change' }], uploadPath: [{ required: true, message: '请填写数据上传路径', trigger: 'blur' }] }
const openAddTask = (proj) => {
  editingProjectId.value = proj.id
  addTaskForm.taskName = ''; addTaskForm.uploadPath = ''; addTaskForm.annotateType = proj.annotateType || '2D拉框'
  addTaskForm.sampleCount = null; addTaskForm.unitPrice = 0.1; addTaskForm.deadline = proj.deadline || ''; addTaskForm.qaStandard = ''
  addTaskVisible.value = true
}
const submitAddTask = async () => {
  try { await addTaskFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    const body = { ...addTaskForm, projectId: editingProjectId.value }
    if (addTaskFile.value) {
      const b64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(addTaskFile.value) })
      body.dataPackage = { fileName: addTaskFile.value.name, data: b64 }
    }
    await createTaskApi(body)
    ElMessage.success('任务已添加')
    addTaskVisible.value = false; addTaskFile.value = null
    loadProjectTasks(editingProjectId.value)
  } finally { actionLoading.value = false }
}

function onAddTaskFileChange(file) { addTaskFile.value = file.raw || file }

// ===== 数据包上传/下载 =====
const pkgInputRef = ref(null)
const pkgUploadingTask = ref(null)
function openUploadPackage(row) {
  pkgUploadingTask.value = row
  pkgInputRef.value?.click()
}
async function onPkgInputChange(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !pkgUploadingTask.value) return
  actionLoading.value = true
  try {
    const b64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(file) })
    const json = await uploadTaskPackageApi(pkgUploadingTask.value.id, { fileName: file.name, fileData: b64 })
    ElMessage.success('数据包已上传')
    loadProjectTasks(selectedId.value)
  } catch { ElMessage.error('上传失败') }
  finally { actionLoading.value = false }
}
async function downloadTaskPackage(row) {
  if (!row.dataPackage?.storedName) { ElMessage.warning('该任务暂无数据包'); return }
  try {
    await downloadFile('/files/download/' + row.dataPackage.storedName, row.dataPackage.fileName || 'data.zip')
  } catch { ElMessage.error('下载失败') }
}

// ===== 编辑任务 =====
const editTaskVisible = ref(false)
const editTaskFormRef = ref(null)
const editTaskForm = reactive({ id: null, taskName: '', annotateType: '', sampleCount: null, unitPrice: 0.1, deadline: '', qaStandard: '' })
const editTaskRules = { taskName: [{ required: true, message: '请输入任务名称' }], annotateType: [{ required: true, message: '请选择类型' }] }
const editTask = (row) => {
  Object.assign(editTaskForm, { id: row.id, taskName: row.taskName, annotateType: row.annotateType, sampleCount: row.sampleCount, unitPrice: row.unitPrice || 0.1, deadline: row.deadline, qaStandard: row.qaStandard?.replace(/<[^>]*>/g, '') || '' })
  editTaskVisible.value = true
}
const submitEditTask = async () => {
  try { await editTaskFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    await updateTaskApi(editTaskForm.id, editTaskForm)
    ElMessage.success('已更新')
    editTaskVisible.value = false
    loadProjectTasks(selectedId.value)
  } finally { actionLoading.value = false }
}
const deleteTask = async (row) => {
  try { await ElMessageBox.confirm(`确认删除「${row.taskName}」？`, '删除', { type: 'warning' }) } catch { return }
  await deleteTaskApi(row.id)
  ElMessage.success('已删除')
  loadProjectTasks(selectedId.value)
}

const handleTaskCommand = (cmd, row) => {
  if (cmd === 'edit') editTask(row)
  else if (cmd === 'dispatch') dispatchSingle(row)
  else if (cmd === 'delete') deleteTask(row)
  else if (cmd === 'workbench') router.push('/workbench/' + row.id)
}

// ===== 派发 =====
const dispatchTaskVisible = ref(false)
const dispatchTaskFormRef = ref(null)
const dispatchForm = reactive({ taskIds: [], taskName: '', supplierId: null, immediateStart: true, qaSamplingRate: 0.2 })
const dispatchSelectedSupplier = computed(() => supplierList.value.find(s => s.id === dispatchForm.supplierId))

const onSelectionChange = (rows) => { selectedTasks.value = rows }
const openDeliverForSelected = () => {
  const t = selectedTasks.value[0]
  if (!t) { ElMessage.warning('请先勾选一个任务'); return }
  if (!['VENDOR_QA', 'REJECTED'].includes(t.state)) { ElMessage.warning('当前任务状态不可提交交付'); return }
  router.push('/task/detail/' + t.id)
}
const goSettlement = () => {
  router.push('/finance/bill')
}
const dispatchSingle = (row) => {
  dispatchForm.taskIds = [row.id]; dispatchForm.taskName = row.taskName
  dispatchForm.supplierId = null; dispatchForm.immediateStart = true; dispatchForm.qaSamplingRate = 0.2
  dispatchTaskVisible.value = true
}
const openBatchDispatch = () => {
  if (!selectedTasks.value.length) { ElMessage.warning('请先勾选任务'); return }
  dispatchForm.taskIds = selectedTasks.value.map(r => r.id)
  dispatchForm.taskName = ''; dispatchForm.supplierId = null; dispatchForm.immediateStart = true; dispatchForm.qaSamplingRate = 0.2
  dispatchTaskVisible.value = true
}
const confirmDispatch = async () => {
  try { await dispatchTaskFormRef.value.validate() } catch { return }
  const sup = supplierList.value.find(s => s.id === dispatchForm.supplierId)
  const count = dispatchForm.taskIds.length
  try {
    await ElMessageBox.confirm(
      `确认将${count > 1 ? ` ${count} 个` : ''}任务派发给【${sup?.name || '指定供应商'}】吗？\n派发后任务将锁定，不可修改。`,
      '派发确认', { confirmButtonText: '确认派发', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  actionLoading.value = true
  try {
    let done = 0
    for (const id of dispatchForm.taskIds) {
      try { await dispatchTaskApi(id, { supplierId: dispatchForm.supplierId, immediateStart: dispatchForm.immediateStart, qaSamplingRate: dispatchForm.qaSamplingRate }); done++ } catch {}
    }
    ElMessage.success(`已派发 ${done}/${dispatchForm.taskIds.length} 条任务`)
    dispatchTaskVisible.value = false
    selectedTasks.value = []
    loadProjectTasks(selectedId.value)
  } finally { actionLoading.value = false }
}

// ===== 验收 =====
const reviewTaskVisible = ref(false)
const reviewFormRef = ref(null)
const reviewForm = reactive({ taskId: null, taskName: '', pass: true, score: null, comment: '', rejectReason: '' })
const reviewRules = {
  score: [{ required: true, message: '请输入分数' }],
  rejectReason: [{ validator: (r, v, cb) => { if (!reviewForm.pass && !v) cb(new Error('请选择驳回分类')); else cb() }, trigger: 'change' }],
  comment: [{ validator: (r, v, cb) => { if (!reviewForm.pass && (!v || v.length < 5)) cb(new Error('驳回需填写原因（至少5字）')); else cb() }, trigger: 'blur' }]
}
const reviewSingle = (row) => {
  reviewForm.taskId = row.id; reviewForm.taskName = row.taskName; reviewForm.pass = true; reviewForm.score = null; reviewForm.comment = ''; reviewForm.rejectReason = ''
  reviewTaskVisible.value = true
}
const confirmReview = async () => {
  try { await reviewFormRef.value.validate() } catch { return }
  actionLoading.value = true
  try {
    await reviewTaskApi(reviewForm.taskId, { pass: reviewForm.pass, score: reviewForm.score, comment: reviewForm.comment, rejectReason: reviewForm.rejectReason })
    ElMessage.success(reviewForm.pass ? '验收通过' : '已驳回')
    reviewTaskVisible.value = false
    loadProjectTasks(selectedId.value)
  } finally { actionLoading.value = false }
}

const handleStatusChange = async (proj, val) => {
  try { await ElMessageBox.confirm(`确认将项目状态变更为「${statusMap[val]}」？`, '状态变更', { type: 'warning' }) } catch { return }
  await updateProjectStatusApi(proj.id, { status: val })
  proj.status = val
  ElMessage.success('状态已更新')
}

const onArchiveProject = async () => {
  const proj = selectedProject.value
  if (!proj) return
  try {
    await ElMessageBox.confirm(
      `结项「${proj.name}」后，所有已验收数据将归档生成 Dataset 版本快照，项目状态变为已归档。`,
      '项目结项归档', { confirmButtonText: '确认结项', type: 'success' }
    )
  } catch { return }
  try {
    const { data, message } = await archiveProjectApi(proj.id)
    if (data) {
      ElMessage.success(`项目已结项归档，生成 Dataset：${data.archivedDataset.name}（${data.archivedDataset.itemCount} 条数据）`)
      loadProjects()
    } else ElMessage.error(message)
  } catch { ElMessage.error('结项失败') }
}

async function onPushFeishu() {
  const proj = selectedProject.value
  if (!proj) return
  try {
    const { data } = await pushProjectSummaryApi(proj.id)
    if (data?.sent) {
      ElMessage.success(`已推送项目摘要到飞书（${data.results?.length || 0} 个群）`)
    } else {
      ElMessage.warning(data?.reason || data?.results?.[0]?.resp || '推送失败，请先配置飞书 Webhook')
    }
  } catch { ElMessage.error('推送失败') }
}

async function downloadSubmission(row) {
  try {
    // 获取任务详情取提交版本
    const { data } = await getTaskDetailApi(row.id)
    const versions = data?.versions || []
    const latest = versions[versions.length - 1]
    if (!latest || !latest.storedName) { ElMessage.warning('该任务尚未提交成果文件'); return }
    // 触发下载
    await downloadFile('/submissions/' + latest.id + '/download', latest.fileName || 'submission_' + latest.id)
  } catch { ElMessage.error('下载失败') }
}

async function handleExpand(row) {
  expandedTaskId.value = row?.id || null
  if (row) loadItems(row)
}

const deleteProject = async (proj) => {
  const taskCount = projectTaskCount[proj.id] || 0
  try {
    await ElMessageBox.confirm(
      `删除项目「${proj.name}」将同时删除其下 ${taskCount} 个任务及相关明细、日志数据，且不可恢复！`,
      '删除项目（级联删除）',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'error', confirmButtonClass: 'el-button--danger' }
    )
  } catch { return }
  try {
    const { data } = await deleteProjectApi(proj.id)
    ElMessage.success(`项目已删除，同时删除 ${data?.deletedTasks ?? 0} 个任务`)
    if (selectedId.value === proj.id) selectedId.value = null
    loadProjects()
  } catch {}
}

// ===== 数据加载 =====
const loadProjects = async () => {
  loading.value = true
  try {
    const { data } = await getProjectsApi()
    projectList.value = data
    loadAllProjects()
    if (!selectedId.value && data.length) {
      selectedId.value = data[0].id
    }
  } finally { loading.value = false }
}

const loadAllProjects = () => { projectList.value.forEach(p => loadProjectTasks(p.id)) }

const loadProjectTasks = async (projectId) => {
  detailLoading.value = true
  try {
    const { data, meta } = await getTaskListApi({ projectId, pageSize: 200 })
    projectTasks[projectId] = data
    projectTaskCount[projectId] = meta.total
    projectAcceptedCount[projectId] = data.filter(t => t.state === 'ACCEPTED').length
    projectActiveCountMap[projectId] = data.filter(t => ['ANNOTATING', 'VENDOR_QA', 'CLIENT_QA'].includes(t.state)).length
    projectOverdueCountMap[projectId] = data.filter(t => isOverdue(t)).length
  } catch {
    projectTasks[projectId] = []; projectTaskCount[projectId] = 0; projectAcceptedCount[projectId] = 0
    projectActiveCountMap[projectId] = 0; projectOverdueCountMap[projectId] = 0
  } finally { detailLoading.value = false }
}

const loadSuppliers = async () => {
  if (supplierList.value.length) return
  try { const { data } = await getSupplierListApi(); supplierList.value = data } catch {}
}

// 加载 TAGGED 状态的治理数据集
const loadGovernanceDatasets = async () => {
  if (governanceDatasets.value.length) return
  try {
    const { data } = await fetchGovernedDatasets()
    governanceDatasets.value = (data || []).filter(d => d.status === 'TAGGED')
  } catch {}
}

function onProjectFileChange(file) {
  const raw = file.raw || file
  uploadForm.fileName = raw.name; uploadForm.fileSize = raw.size
  if (!uploadForm.datasetName) uploadForm.datasetName = raw.name.replace(/\.(zip|tar|gz|7z|csv|xlsx|json|mp4|avi|mov|mkv)$/i, '')
  const m = raw.name.match(/_(\d+)\./); if (m) uploadForm.itemCount = Math.min(Number(m[1]), 500)
}

function fmtSize(b) { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0, s = b; while (s >= 1024 && i < 3) { s /= 1024; i++ } return s.toFixed(1) + ' ' + u[i] }

// Excel 导入 → 后端解析后填充任务明细
async function onTaskExcelImport(file) {
  const raw = file.raw || file
  try {
    const reader = new FileReader()
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => { const data = reader.result.split(',')[1]; resolve(data) }
      reader.onerror = reject
      reader.readAsDataURL(raw)
    })
    const { data, message } = await parseProjectExcelApi({ fileName: raw.name, fileData: base64 })
    if (!data?.tasks) { ElMessage.error(message || '解析失败'); return }
    const taskRows = data.tasks || []
    createForm.tasks = taskRows.map(t => ({ ...t, uploadPath: t.uploadPath || createForm.uploadPath || '' }))
    ElMessage.success(`已解析 ${taskRows.length} 条任务明细（列：${(data.columns || []).join('、')}）`)
  } catch (e) {
    ElMessage.error('解析失败：' + e.message)
  }
}

// 自动拆分：将绑定的数据集按每 N 张图拆分为任务
const autoSplitTasks = async () => {
  const itemsPerTask = 10
  try {
    const { data, message } = await previewSplitApi({ datasetId: createForm.datasetId, itemsPerTask })
    if (!data?.tasks) { ElMessage.error(message || '拆分失败'); return }
    const taskPreviews = data.tasks || []
    createForm.tasks = taskPreviews.map(t => ({
      taskName: t.taskName, annotateType: createForm.annotateType || '2D拉框',
      sampleCount: t.sampleCount, unitPrice: 0.1, deadline: createForm.deadline || '', qaStandard: '',
      uploadPath: t.uploadPath || createForm.uploadPath || ''
    }))
    ElMessage.success(`已拆分 ${taskPreviews.length} 个任务（每 ${itemsPerTask} 条 = 1 个 Task）`)
  } catch { ElMessage.error('拆分失败') }
}

// ===== 明细 =====
const loadItems = async (taskRow) => {
  const taskId = taskRow && taskRow.id
  if (!taskId) return
  if (taskItems[taskId]) return
  itemsLoading[taskId] = true
  try { const { data } = await getTaskItemsApi(taskId); taskItems[taskId] = data }
  catch { taskItems[taskId] = [] }
  finally { itemsLoading[taskId] = false }
}
const itemsByStatus = (taskId, status) => (taskItems[taskId] || []).filter(i => i.status === status).length
const updateItemStatus = async (taskId, item, newStatus) => {
  try { await updateTaskItemApi(taskId, item.id, { status: newStatus }); item.status = newStatus; ElMessage.success(`状态已更新为${ITEM_STATUS_MAP[newStatus]}`) } catch { ElMessage.error('更新失败') }
}
const saveFailReason = async (taskId, item) => {
  try { await updateTaskItemApi(taskId, item.id, { status: item.status, failReason: item.failReason }); ElMessage.success('备注已保存') } catch { ElMessage.error('保存失败') }
}
const batchUpdateItems = async (taskRow) => {
  const items = taskItems[taskRow.id] || []
  if (!items.length) return ElMessage.warning('没有明细')
  try { await batchUpdateTaskItemsApi(taskRow.id, { itemIds: items.map(i => i.id), status: 'annotated' }); items.forEach(i => { i.status = 'annotated'; i.failReason = '' }); ElMessage.success('全部标为已标注') } catch { ElMessage.error('操作失败') }
}

const importItemsText = ref('')
const importItemsPreview = ref([])
const importItemsFileList = ref([])
const importItemsVisible = ref(false)
const importingTaskId = ref(null)
const openImportItems = (taskRow) => { 
  importItemsText.value = ''; importItemsFileList.value = []; importItemsPreview.value = []
  importingTaskId.value = taskRow ? taskRow.id : null
  importItemsVisible.value = true 
}
const handleImportItemsFile = (file) => {
  const raw = file.raw || file
  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1]
    actionLoading.value = true
    try {
      const json = await importTaskItemsFileApi(importingTaskId.value, { fileName: raw.name, fileData: base64 })
      ElMessage.success(`导入 ${json.data.imported} 条明细`)
      importItemsVisible.value = false
      taskItems[importingTaskId.value] = null; loadItems({ id: importingTaskId.value })
    } catch { ElMessage.error('导入失败') }
    finally { actionLoading.value = false }
  }
  reader.readAsDataURL(raw)
}
const submitImportItems = async () => {
  if (!importItemsPreview.value.length) return
  actionLoading.value = true
  try { const { data } = await importTaskItemsApi(importingTaskId.value, { rows: importItemsPreview.value }); ElMessage.success(`导入 ${data.imported} 条明细`); importItemsVisible.value = false; taskItems[importingTaskId.value] = null; loadItems({ id: importingTaskId.value }) } catch { ElMessage.error('导入失败') } finally { actionLoading.value = false }
}
const downloadItemsTemplate = () => {
  const BOM = '\uFEFF'
  const content = BOM + '明细名称,数据类型,标注人,标注状态,备注,数据上传路径\n样本-001,图像,张三,annotated,,/data/upload/a\n样本-002,点云,李四,pending,,/data/upload/b\n样本-003,图像,王五,failed,图像模糊,/data/upload/c'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '明细导入模板.csv'; a.click()
  URL.revokeObjectURL(a.href)
}
const deleteItem = async (taskId, item) => {
  try { await deleteTaskItemApi(taskId, item.id); const idx = taskItems[taskId]?.indexOf(item); if (idx >= 0) taskItems[taskId].splice(idx, 1); ElMessage.success('明细已删除') } catch { ElMessage.error('删除失败') }
}

// 批量导入项目
const openImport = () => {
  ElMessageBox.prompt('批量导入项目（每行一个）：\n项目名称,标注类型,样本数量,截止时间', '导入项目', {
    confirmButtonText: '导入', inputType: 'textarea',
    inputPlaceholder: '示例项目,3D点云标注,50000,2026-09-30\n示例项目2,2D拉框,30000,2026-10-15'
  }).then(async ({ value }) => {
    const rows = value.trim().split('\n').filter(l => l.trim()).map(line => {
      const p = line.split(',').map(s => s.trim())
      return { name: p[0] || '-', annotateType: p[1] || '2D拉框', sampleCount: Number(p[2]) || 0, deadline: p[3] || '-', description: p[4] || '' }
    })
    if (!rows.length) return
    actionLoading.value = true
    try { const { data } = await importProjectsApi(rows); ElMessage.success(`导入 ${data.imported} 个项目`); loadProjects() } finally { actionLoading.value = false }
  }).catch(() => {})
}

onMounted(() => { loadProjects(); window.addEventListener('focus', loadProjects); window.addEventListener('visibilitychange', () => { if (!document.hidden) loadProjects() }) })
</script>

<style scoped>
.pm-page { display: flex; flex-direction: column; }
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.stat-card { text-align: center; }
.stat-num { font-size: 28px; font-weight: bold; }
.stat-label { color: #909399; margin-top: 6px; font-size: 13px; }

.pm-body { display: grid; grid-template-columns: 320px 1fr; gap: 12px; min-height: 0; }

/* 左侧项目列表 */
.proj-list-panel { display: flex; flex-direction: column; background: #fff; border-radius: 8px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.list-toolbar { margin-bottom: 10px; }
.list-filter { margin-bottom: 12px; }
.list-filter :deep(.el-radio-group) { width: 100%; display: flex; }
.list-filter :deep(.el-radio-button) { flex: 1; }
.list-filter :deep(.el-radio-button__inner) { width: 100%; padding: 6px 4px; font-size: 12px; }
.proj-cards { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; min-height: 200px; max-height: calc(100vh - 320px); }
.proj-card { border: 1px solid #ebeef5; border-radius: 8px; padding: 12px; cursor: pointer; transition: all 0.2s; }
.proj-card:hover { border-color: #c6e2ff; box-shadow: 0 2px 8px rgba(64,158,255,0.12); }
.proj-card.active { border-color: #409eff; background: #ecf5ff; }
.proj-card.overdue { border-left: 3px solid #f56c6c; }
.pc-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
.pc-name { font-weight: 600; font-size: 14px; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-client { font-size: 12px; color: #909399; margin-bottom: 8px; }
.pc-progress { display: flex; align-items: center; gap: 8px; }
.pc-progress :deep(.el-progress) { flex: 1; }
.pc-progress-text { font-size: 11px; color: #909399; white-space: nowrap; }
.pc-footer { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.pc-tasks { display: flex; align-items: center; gap: 3px; font-size: 12px; color: #909399; margin-right: auto; }
.list-footer { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #ebeef5; }

/* 右侧工作区 */
.proj-detail-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.proj-header { display: flex; }
.proj-header :deep(.el-card__body) { display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 16px; }
.ph-main { flex: 1; min-width: 0; }
.ph-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ph-name { font-size: 18px; font-weight: 700; color: #303133; }
.ph-desc { margin-bottom: 4px; }
.ph-desc-text { font-size: 13px; color: #909399; margin-top: 8px; line-height: 1.6; }
.ph-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.task-panel :deep(.el-card__body) { padding: 12px 16px; }
.tp-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.tp-title { font-size: 15px; font-weight: 600; border-left: 3px solid #409eff; padding-left: 8px; }
.tp-actions { display: flex; gap: 8px; }

.state-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip { padding: 4px 12px; border-radius: 16px; background: #f5f7fa; color: #606266; font-size: 13px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; user-select: none; }
.chip b { margin-left: 2px; }
.chip:hover { background: #ecf5ff; }
.chip.active { background: #409eff; color: #fff; }
.chip-warning.active { background: #e6a23c; }
.chip-primary.active { background: #409eff; }
.chip-success.active { background: #67c23a; }
.chip-danger.active { background: #f56c6c; }

.task-name-cell { display: flex; align-items: center; gap: 4px; }
:deep(.row-overdue) { background: #fef0f0; }

.items-section { padding: 12px; background: #fafafa; border-radius: 6px; }
.items-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.create-steps { margin-bottom: 4px; }
.step2-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.step2-tip { font-size: 13px; color: #909399; }
.create-total { text-align: right; color: #e6a23c; font-weight: bold; margin-top: 8px; font-size: 13px; }
.supplier-info { background: #f5f7fa; border-radius: 6px; padding: 12px; margin: 8px 0; }
.si-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; color: #606266; }
.si-row span { color: #909399; }
.import-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.import-preview { margin-top: 16px; padding-top: 12px; border-top: 1px solid #ebeef5; }
.import-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
</style>
