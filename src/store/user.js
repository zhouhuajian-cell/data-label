// 统一用户状态（账号可持多角色，userInfo.roleTypes 为全部角色，roleType 为主角色）
import { defineStore } from 'pinia'
import { roleTypesOf, hasRole, hasAnyRole } from '@/utils/constants'

const DEFAULT_INFO = { userName: '', roleType: 1, roleTypes: [1], mustChangePassword: false }

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    userInfo: JSON.parse(localStorage.getItem('userInfo') || 'null') || { ...DEFAULT_INFO },
    unReadMsg: 0,
    pendingTaskCount: 0
  }),
  getters: {
    roles: (state) => roleTypesOf(state.userInfo),
    isAdmin: (state) => hasRole(state.userInfo, 1),
    isQA: (state) => hasRole(state.userInfo, 2),
    isSupplier: (state) => hasRole(state.userInfo, 3),
    isInternal: (state) => hasAnyRole(state.userInfo, [1, 2, 6, 7, 13, 14, 15, 16])
  },
  actions: {
    setToken(val) {
      this.token = val
      localStorage.setItem('token', val)
    },
    setLogin(payload) {
      this.token = payload.token
      this.setUserInfo(payload.userInfo)
      localStorage.setItem('token', payload.token)
    },
    setUserInfo(info) {
      const normalized = { ...DEFAULT_INFO, ...info }
      normalized.roleTypes = roleTypesOf(normalized)
      normalized.roleType = normalized.roleTypes[0]
      this.userInfo = normalized
      localStorage.setItem('userInfo', JSON.stringify(normalized))
    },
    markPasswordChanged() {
      this.setUserInfo({ ...this.userInfo, mustChangePassword: false })
    },
    logout() {
      this.token = ''
      this.userInfo = { ...DEFAULT_INFO }
      localStorage.removeItem('token')
      localStorage.removeItem('userInfo')
      window.__router?.push('/login')
    }
  }
})
