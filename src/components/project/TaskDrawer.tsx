import { Drawer } from '../ui'

export default function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void; onChanged?: () => void }) {
  return <Drawer open={Boolean(taskId)} onClose={onClose} title="Tâche"><p className="p-4">…</p></Drawer>
}
