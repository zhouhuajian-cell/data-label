<template>
  <div v-loading="loading" class="items-section">
    <div class="items-toolbar">
      <el-tag v-for="(label, code) in ITEM_STATUS_MAP" :key="code" :type="itemStatusTagType(code)" size="small">
        {{ label }}: {{ itemsByStatus(code) }}
      </el-tag>
      <el-button size="small" type="primary" plain @click="emit('batch-update', taskRow)">批量已标注</el-button>
      <el-button size="small" :icon="Upload" @click="emit('import-items', taskRow)">导入明细</el-button>
    </div>
    <el-table :data="items" border size="small">
      <el-table-column label="明细名称" prop="itemName" min-width="150" show-overflow-tooltip />
      <el-table-column label="场景" width="72"><template #default="is">{{ is.row.metadata?.scene || '-' }}</template></el-table-column>
      <el-table-column label="城市" width="70"><template #default="is">{{ is.row.metadata?.city || '-' }}</template></el-table-column>
      <el-table-column label="里程" width="70"><template #default="is">{{ is.row.metadata?.mileage || '-' }}</template></el-table-column>
      <el-table-column label="车型" width="80"><template #default="is">{{ is.row.metadata?.model || '-' }}</template></el-table-column>
      <el-table-column label="数据类型" prop="dataType" width="80" />
      <el-table-column label="标注人" prop="annotator" width="70" />
      <el-table-column label="标注状态" width="110">
        <template #default="is">
          <el-select :model-value="is.row.status" size="small" @change="(v) => emit('update-status', taskRow.id, is.row, v)">
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
              <el-button size="small" type="primary" style="margin-top:8px" @click="emit('save-fail-reason', taskRow.id, is.row)">保存</el-button>
            </el-popover>
          </template>
          <span v-else style="color:#c0c4cc">-</span>
        </template>
      </el-table-column>
      <el-table-column label="数据下载路径" min-width="150" show-overflow-tooltip><template #default="is">{{ is.row.metadata?.downloadPath || '-' }}</template></el-table-column>
      <el-table-column label="数据上传路径" min-width="170" show-overflow-tooltip><template #default="is">{{ is.row.uploadPath || '-' }}</template></el-table-column>
      <el-table-column label="操作" width="60">
        <template #default="is">
          <el-popconfirm title="确定删除？" @confirm="emit('delete-item', taskRow.id, is.row)">
            <template #reference><el-button size="small" text type="danger">删除</el-button></template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!items.length" description="暂无明细" :image-size="40" />
  </div>
</template>

<script setup>
import { Upload } from '@element-plus/icons-vue'
import { ITEM_STATUS_MAP } from '@/utils/constants'

const props = defineProps({
  items: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  taskRow: { type: Object, default: null }
})
const emit = defineEmits(['update-status', 'save-fail-reason', 'delete-item', 'batch-update', 'import-items'])

const itemStatusTagType = (code) => (['failed', 'rejected'].includes(code) ? 'danger' : code === 'annotated' ? 'success' : code === 'pending' ? 'info' : '')
const itemsByStatus = (status) => props.items.filter(i => i.status === status).length
</script>

<style scoped>
.items-section { padding: 4px 0; }
.items-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
</style>
