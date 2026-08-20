// 统一用户状态（旧业务域 roleType 1-7 + GND 业务域 roleType 8-12，共用 token/userInfo）
import { defineStore } from 'pinia'

const DEFAULT_INFO = { userName: '', roleType: 1, supplierId: null, domain: 'legacy', status: 'ACTIVE' }

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    userInfo: JSON.parse(localStorage.getItem('userInfo') || 'null') || { ...DEFAULT_INFO },
    unReadMsg: 0,
    pendingTaskCount: 0
  }),
  getters: {
    // 旧业务域（1-7）
    isAdmin: (state) => state.userInfo.roleType === 1,
    isQA: (state) => state.userInfo.roleType === 2,
    isSupplier: (state) => state.userInfo.roleType === 3,
    // GND 业务域（8-12）
    isGnd: (state) => state.userInfo.domain === 'gnd',
    isGndPending: (state) => state.userInfo.domain === 'gnd' && state.userInfo.status === 'PENDING',
    isTaixingAdmin: (state) => state.userInfo.roleType === 1 || state.userInfo.roleType === 8, // 泰兴管理员 = 老管理员(1) + GND 管理员(8)
    isOptimizer: (state) => state.userInfo.roleType === 9,
    isAcceptor: (state) => state.userInfo.roleType === 10,
    isPerception: (state) => state.userInfo.roleType === 11,
    isGndSupplier: (state) => state.userInfo.roleType === 12
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
      localStorage.removeItem('gnd_token')
      localStorage.removeItem('gnd_userInfo')
      window.__router?.push('/login')
    }
  }
})
