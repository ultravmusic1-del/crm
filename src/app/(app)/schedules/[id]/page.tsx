import { notFound } from 'next/navigation'
import { getSchedule } from '@/lib/queries/orders'
import { getOrderFormData } from '@/lib/queries/order-form'
import { ScheduleDetail } from './schedule-detail'

export default async function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const schedule = await getSchedule(id)
  if (!schedule) notFound()

  const { customers, products } = await getOrderFormData()

  return <ScheduleDetail schedule={schedule} customers={customers} products={products} />
}
