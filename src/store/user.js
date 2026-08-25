// 统一用户状态（业务角色 roleType 1-7，共用 token/userInfo）
import { defineStore } from 'pinia'

const DEFAULT_INFO = { userName: '', roleType: 1, supplierId: null }

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    userInfo: JSON.parse(localStorage.getItem('userInfo') || 'null') || { ...DEFAULT_INFO },
    unReadMsg: 0,
    pendingTaskCount: 0
  }),
  getters: {
    isAdmin: (state) => state.userInfo.roleType === 1,
    isQA: (state) => state.userInfo.roleType === 2,
    isSupplier: (state) => state.userInfo.roleType === 3
  },
  actions: {
    setToken(val) {
      this.token = val
      localStorage.setItem('token', val)
    },
    setLogin(payload) {
      this.token = payload.token
      this.userInfo = payload.userInfo
      localStorage.setItem('token', payload.token)
      localStorage.setItem('userInfo', JSON.stringify(payload.userInfo))
    },
    setUserInfo(info) {
      this.userInfo = info
      localStorage.setItem('userInfo', JSON.stringify(info))
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
