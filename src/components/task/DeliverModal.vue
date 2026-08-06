<template>
  <el-dialog :model-value="visible" title="提交任务成果" width="620px" @update:model-value="close">
    <div class="task-info">
      <p>任务：{{ taskInfo.taskName }}</p>
      <p>状态：<el-tag>{{ taskInfo.state }}</el-tag></p>
    </div>

    <el-upload
      drag
      action="#"
      :limit="1"
      :auto-upload="false"
      :on-change="handleFileChange"
      :on-remove="handleFileRemove"
      accept=".zip,.tar.gz,.7z"
      class="upload-box"
    >
      <Box size="40" />
      <div class="text">点击或拖拽文件到此处上传</div>
      <div class="tip">支持 zip/tar.gz/7z，数据包必传，为空不允许提交</div>
    </el-upload>

    <div v-if="fileInfo" class="file-row">
      <Document /> 已选择：{{ fileInfo.name }}
    </div>

    <el-form-item label="提交备注">
      <el-input
        v-model="submitDesc"
        type="textarea"
        rows="3"
        placeholder="标注工具版本、特殊处理说明、已知问题（选填，任意字数）"
      ></el-input>
    </el-form-item>

    <el-checkbox v-model="checkRule">
      已按规范完成标注、自检文件完整性、清除测试数据
    </el-checkbox>

    <template #footer>
      <el-button @click="close(false)">取消</el-button>
      <el-button
        type="primary"
        :loading="loading"
        :disabled="!fileInfo || !checkRule"
        @click="submitDeliver"
      >
        确认提交
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Box, Document } from '@element-plus/icons-vue'
import { submitTaskApi } from '@/api/tasks'

const props = defineProps({
  visible: Boolean,
  taskInfo: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:visible', 'success'])

const loading = ref(false)
const fileInfo = ref(null)
const submitDesc = ref('')
const checkRule = ref(false)

const reset = () => {
  fileInfo.value = null
  submitDesc.value = ''
  checkRule.value = false
}

const close = (value) => {
  emit('update:visible', value)
  if (!value) reset()
}

watch(() => props.visible, (val) => {
  if (!val) reset()
})

const handleFileChange = (file) => {
  fileInfo.value = file.raw || file
}

const handleFileRemove = () => {
  fileInfo.value = null
}

const submitDeliver = async () => {
  const file = fileInfo.value
  if (!file) { ElMessage.warning('请先上传数据包文件'); return }
  loading.value = true
  try {
    // 读取文件为 base64 发送
    const reader = new FileReader()
    const fileData = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const base64 = reader.result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    await submitTaskApi(props.taskInfo.id, {
      fileName: file.name,
      fileSize: file.size,
      fileData,
      submitDesc: submitDesc.value
    })
    ElMessage.success('成果提交成功，等待质检')
    emit('success')
    close(false)
  } catch {
    ElMessage.error('提交失败')
  } finally { loading.value = false }
}
</script>

<style scoped>
.task-info {
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}
.upload-box {
  margin: 16px 0;
}
.file-row {
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
