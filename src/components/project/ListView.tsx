import type { ProjectDetail } from '../../lib/types'

export default function ListView({ project }: { project: ProjectDetail; onChanged: () => void }) {
  return <p className="p-4 text-sm text-muted-foreground">{project.name}</p>
}
