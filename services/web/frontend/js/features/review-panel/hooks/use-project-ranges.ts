import { useCallback, useEffect, useMemo, useState } from 'react'
import { debounce } from 'lodash'
import { Ranges } from '../context/ranges-context'
import { useProjectContext } from '@/shared/context/project-context'
import { getJSON } from '@/infrastructure/fetch-json'
import useSocketListener from '@/features/ide-react/hooks/use-socket-listener'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import getMeta from '@/utils/meta'
import { buildProjectRangesFromSnapshot } from '@/features/review-panel/utils/snapshot-ranges'

export default function useProjectRanges() {
  const { projectId, features, projectSnapshot } = useProjectContext()
  const [error, setError] = useState<Error>()
  const [projectRanges, setProjectRanges] = useState<Map<string, Ranges>>()
  const [loading, setLoading] = useState(true)
  const { socket } = useConnectionContext()
  const otMigrationStage = getMeta('ol-otMigrationStage')

  const refresh = useCallback(async () => {
    try {
      if (otMigrationStage > 0 && !features.reviewActionsViaHttp) {
        await projectSnapshot.refresh()
        setProjectRanges(buildProjectRangesFromSnapshot(projectSnapshot))
      } else {
        const data = await getJSON<{ id: string; ranges: Ranges }[]>(
          `/project/${projectId}/ranges`
        )
        setProjectRanges(
          new Map(
            data.map(item => [
              item.id,
              {
                docId: item.id,
                changes: item.ranges.changes ?? [],
                comments: item.ranges.comments ?? [],
              },
            ])
          )
        )
      }
      setError(undefined)
    } catch (error) {
      setError(error as Error)
    } finally {
      setLoading(false)
    }
  }, [
    projectId,
    otMigrationStage,
    features.reviewActionsViaHttp,
    projectSnapshot,
  ])

  const refreshSoon = useMemo(
    () => debounce(refresh, 500, { maxWait: 2000 }),
    [refresh]
  )
  useEffect(() => {
    setLoading(true)
    refresh()
    window.addEventListener('doc:saved', refreshSoon)
    return () => {
      refreshSoon.cancel()
      window.removeEventListener('doc:saved', refreshSoon)
    }
  }, [refresh, refreshSoon])

  useSocketListener(socket, 'new-comment', refreshSoon)
  useSocketListener(socket, 'project-review-updated', refreshSoon)
  useSocketListener(socket, 'accept-changes', refreshSoon)
  useSocketListener(socket, 'otUpdateApplied', refreshSoon)

  return { projectRanges, error, loading }
}
