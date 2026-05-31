'use client'
import { useParams } from 'next/navigation'
import RideDetailView from '@/components/ride/RideDetailView'

export default function RidePage() {
  const { workoutId } = useParams<{ workoutId: string }>()
  return <RideDetailView fetchUrl={`/api/rides/${workoutId}/streams`} />
}
