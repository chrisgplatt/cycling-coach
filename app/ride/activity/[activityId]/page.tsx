'use client'
import { useParams } from 'next/navigation'
import RideDetailView from '@/components/ride/RideDetailView'

export default function ActivityRidePage() {
  const { activityId } = useParams<{ activityId: string }>()
  return <RideDetailView fetchUrl={`/api/rides/activity/${activityId}/streams`} />
}
