import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authAPI } from '@/services/api'

const getNested = (input, path) => {
  let cur = input
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

const normalizeToken = (raw) => {
  const token = raw != null ? String(raw).trim() : ''
  if (!token) return null
  return token.replace(/^bearer\s+/i, '').trim() || null
}

const parseAuthPayload = (response) => {
  const payload = response && typeof response === 'object' ? response : {}

  const candidates = [
    payload,
    getNested(payload, ['data']),
    getNested(payload, ['data', 'data']),
    getNested(payload, ['result']),
    getNested(payload, ['result', 'data']),
    getNested(payload, ['data', 'result'])
  ].filter((v) => v && typeof v === 'object')

  const token =
    candidates.map((c) => c.token).find(Boolean) ??
    candidates.map((c) => c.accessToken).find(Boolean) ??
    candidates.map((c) => c.jwt).find(Boolean)

  const user =
    candidates.map((c) => c.user).find(Boolean) ??
    candidates.map((c) => c.currentUser).find(Boolean) ??
    candidates.map((c) => c.profile).find(Boolean)

  const message =
    candidates.map((c) => c.message).find((v) => v != null && v !== '') ??
    candidates.map((c) => c.msg).find((v) => v != null && v !== '')

  const successFlag = candidates.map((c) => c.success).find((v) => typeof v === 'boolean')
  const code = candidates.map((c) => c.code).find((v) => v != null)
  const errcode = candidates.map((c) => c.errcode).find((v) => v != null)

  const isSuccessByFlag = successFlag === true
  const isFailureByFlag = successFlag === false
  const isSuccessByCode = Number.isFinite(Number(code)) ? Number(code) === 0 : false
  const isFailureByCode = Number.isFinite(Number(code)) ? Number(code) !== 0 : false
  const isSuccessByErrcode = Number.isFinite(Number(errcode)) ? Number(errcode) === 0 : false
  const isFailureByErrcode = Number.isFinite(Number(errcode)) ? Number(errcode) !== 0 : false

  const ok =
    (isSuccessByFlag || isSuccessByCode || isSuccessByErrcode) &&
    Boolean(token) &&
    Boolean(user)

  const bad =
    isFailureByFlag ||
    isFailureByCode ||
    isFailureByErrcode

  return { ok, bad, token: normalizeToken(token), user: user || null, message: message || '' }
}

const clearAuthLock = () => {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) return
    window.localStorage.removeItem('erp_auth_lock_until')
    window.localStorage.removeItem('erp_unauth_hits')
  } catch (_) { void 0 }
}

const useAuthStore = create(
  persist(
    (set, get) => ({
      // 用户信息
      user: null,
      token: null,
      isAuthenticated: false,
      hydrated: false,

      finishHydration: () => {
        const token = normalizeToken(get().token)
        const next = { hydrated: true, isAuthenticated: Boolean(token) }
        if (token !== get().token) next.token = token
        set(next)
      },
      
      // 登录
      login: async (credentials) => {
        try {
          const response = await authAPI.login(credentials)
          const parsed = parseAuthPayload(response)
          const token = normalizeToken(parsed.token)
          const user = parsed.user

          if (parsed.bad) return { success: false, message: parsed.message || '登录失败' }
          if (!parsed.ok) return { success: false, message: parsed.message || '登录失败' }
          
          set({
            user,
            token,
            isAuthenticated: true
          })
          clearAuthLock()
          
          return { success: true }
        } catch (error) {
          return { 
            success: false, 
            message: error.response?.data?.message || '登录失败' 
          }
        }
      },
      
      // 登出
      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false
        })
        clearAuthLock()
      },
      
      // 检查认证状态
      checkAuth: async () => {
        const { token } = get()
        if (!token) {
          set({ isAuthenticated: false })
          return false
        }
        
        try {
          const response = await authAPI.verifyToken()
          const payload = response && typeof response === 'object' ? response : {}
          const candidates = [
            payload,
            getNested(payload, ['data']),
            getNested(payload, ['data', 'data']),
            getNested(payload, ['result']),
            getNested(payload, ['result', 'data'])
          ].filter((v) => v && typeof v === 'object')
          const user =
            candidates.map((c) => c.user).find(Boolean) ??
            candidates.map((c) => c.currentUser).find(Boolean) ??
            candidates.map((c) => c.profile).find(Boolean) ??
            null
          const successFlag = candidates.map((c) => c.success).find((v) => typeof v === 'boolean')

          if (successFlag === false || !user) {
            throw new Error(payload.message || '认证失败')
          }

          set({ user, isAuthenticated: true })
          return true
        } catch (error) {
          set({ 
            user: null, 
            token: null, 
            isAuthenticated: false 
          })
          return false
        }
      },
      
      // 更新用户信息
      updateUser: (userData) => {
        set({ user: { ...get().user, ...userData } })
      }
    }),
    {
      name: 'auth-storage',
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.finishHydration()
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState && typeof persistedState === 'object') ? persistedState : {}
        const merged = { ...currentState, ...persisted, token: normalizeToken(persisted.token) }

        if (currentState.token && !persisted.token) merged.token = currentState.token
        if (currentState.user && !persisted.user) merged.user = currentState.user
        if (currentState.isAuthenticated && persisted.isAuthenticated === false) {
          merged.isAuthenticated = currentState.isAuthenticated
        }
        return merged
      },
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
)

export { useAuthStore }
