'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

function fmt(n: number) { return new Intl.NumberFormat('ko-KR').format(n) }
const statusColors: Record<string, string> = { '진행중': 'bg-blue-100 text-blue-800', '보완필요': 'bg-yellow-100 text-yellow-800', '중단': 'bg-red-100 text-red-800', '완료': 'bg-green-100 text-green-800' }

export default function BudgetPage() {
  const supabase = createClient()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: companies } = await supabase.from('companies').select('*').order('name')
      const { data: budgetItems } = await supabase.from('budget_items').select('*')
      const result = (companies || []).map(c => {
        const items = (budgetItems || []).filter(b => b.company_id === c.id)
        const planned = items.reduce((s: number, b: any) => s + (b.planned_amount || 0), 0)
        const executed = items.reduce((s: number, b: any) => s + (b.executed_amount || 0), 0)
        const rate = planned > 0 ? Math.round((executed / planned) * 100) : 0
        return { ...c, planned, executed, rate }
      })
      setData(result)
      setLoading(false)
    }
    load()
  }, [])

  const totalPlanned = data.reduce((s, c) => s + c.planned, 0)
  const totalExecuted = data.reduce((s, c) => s + c.executed, 0)
  const totalRate = totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">전체 계획 예산</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalPlanned)}원</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">전체 집행 금액</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{fmt(totalExecuted)}원</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">전체 집행률</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalRate}%</p>
          <div className="mt-2 h-3 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${totalRate}%` }} /></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-5 py-3 font-medium">기업명</th>
                <th className="text-left px-5 py-3 font-medium">분야</th>
                <th className="text-right px-5 py-3 font-medium">정부지원금</th>
                <th className="text-right px-5 py-3 font-medium">계획 예산</th>
                <th className="text-right px-5 py-3 font-medium">집행액</th>
                <th className="text-right px-5 py-3 font-medium">집행률</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3"><Link href={`/companies/${c.id}`} className="text-blue-600 hover:underline font-medium">{c.name}</Link></td>
                  <td className="px-5 py-3 text-gray-700">{c.category}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{fmt(c.gov_support)}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{fmt(c.planned)}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{fmt(c.executed)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${c.rate >= 80 ? 'bg-green-500' : c.rate >= 50 ? 'bg-blue-500' : c.rate >= 20 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(c.rate, 100)}%` }} /></div>
                      <span className="font-medium text-gray-900 w-10 text-right">{c.rate}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center"><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[c.status]}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
