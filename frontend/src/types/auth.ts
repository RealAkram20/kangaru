export interface User {
  id: number
  tenant_id: number | null
  name: string
  email: string
  role: string
  created_at: string
}
