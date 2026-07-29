import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    userInfo: JSON.parse(localStorage.getItem('userInfo') || 'null') || {
      userName: '',
      roleType: 1,
      supplierId: null
    },
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
    setUserInfo(info) {
      this.userInfo = info
      localStorage.setItem('userInfo', JSON.stringify(info))
    },
    logout() {
      this.token = ''
      this.userInfo = { userName: '', roleType: 1, supplierId: null }
      localStorage.removeItem('token')
      localStorage.removeItem('userInfo')
      window.__router?.push('/login')
    }
  }
})
