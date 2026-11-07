import { inject, type Ref } from 'vue'

export const PERMISSIONS_KEY = Symbol('pacificpower-permissions')

export type PermissionSource = Readonly<Ref<readonly string[] | undefined>>

/**
 * Returns a permission checker shared by the project workspace.
 * Components rendered in isolated tests or the local no-auth demo remain permissive.
 */
export function usePermission() {
  const source = inject<PermissionSource | undefined>(PERMISSIONS_KEY, undefined)
  return (permission: string) => source?.value === undefined || source.value.includes(permission)
}
