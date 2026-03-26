'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Stats {
  total: number; active: number; supplement: number; stopped: number; completed: number;
  totalPlanned: number; totalExecuted: number; execRate: number;
  pendingChanges: number; pendingPurchases: number;
  byCategory: { category: string; cnt: number }[];
  byRegion: { region: string; cnt: number }[];
  execByCompany: { id: number; name: string; gov_support: number; executed: number; planned: number; status: string }[];
}

const statusColors: Record<string, string> = {
  '진행중': 'bg-blue-100 text-blue-800',
  '보완필요': 'bg-yellow-100 text-yellow-800',
  '중단': 'bg-red-100 text-red-800',
  '완료': 'bg-green-100 text-green-800',
}

function fmt(n: number) {
  return new Intl.NumberFormat('ko-KR').format(n)
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      // Fetch companies
      const { data: companies } = await supabase.from('companies').select('*')
      if (!companies) return

      const total = companies.length
      const active = companies.filter(c => c.status === '진행중').length
      const supplement = companies.filter(c => c.status === '보완필요').length
      const stopped = companies.filter(c => c.status === '중단').length
      const completed = companies.filter(c => c.status === '완료').length

      // Budget items
      const { data: budgetItems } = await supabase.from('budget_items').select('*')
      const totalPlanned = budgetItems?.reduce((s, b) => s + (b.planned_amount || 0), 0) || 0
      const totalExecuted = budgetItems?.reduce((s, b) => s + (b.executed_amount || 0), 0) || 0
      const execRate = totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0

      // Pending counts
      const { count: pendingChanges } = await supabase.from('change_requests').select('*', { count: 'exact', head: true }).eq('status', '검토중')
      const { count: pendingPurchases } = await supabase.from('purchase_approvals').select('*', { count: 'exact', head: true }).eq('status', '검토중')

      // By category
      const catMap: Record<string, number> = {}
      companies.forEach(c => { catMap[c.category] = (catMap[c.category] || 0) + 1 })
      const byCategory = Object.entries(catMap).map(([category, cnt]) => ({ category, cnt }))

      // By region
      const regMap: Record<string, number> = {}
      companies.forEach(c => { regMap[c.region] = (regMap[c.region] || 0) + 1 })
      const byRegion = Object.entries(regMap).map(([region, cnt]) => ({ region, cnt }))

      // Exec by company
      const execByCompany = companies.map(c => {
        const items = budgetItems?.filter(b => b.company_id === c.id) || []
        const planned = items.reduce((s, b) => s + (b.planned_amount || 0), 0)
        const executed = items.reduce((s, b) => s + (b.executed_amount || 0), 0)
        return { id: c.id, name: c.name, gov_support: c.gov_support, executed, planned, status: c.status }
      })

      setStats({
        total, active, supplement, stopped, completed,
        totalPlanned, totalExecuted, execRate,
        pendingChanges: pendingChanges || 0,
        pendingPurchases: pendingPurchases || 0,
        byCategory, byRegion, execByCompany,
      })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!stats) return null

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: '전체 기업', value: stats.total, color: 'text-gray-900' },
          { label: '진행중', value: stats.active, color: 'text-blue-600' },
          { label: '보완필요', value: stats.supplement, color: 'text-yellow-600' },
          { label: '중단', value: stats.stopped, color: 'text-red-600' },
          { label: '완료', value: stats.completed, color: 'text-green-600' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Budget & Pending */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">전체 예산 집행률</h3>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-gray-900">{stats.execRate}%</span>
          </div>
          <div className="mt-3 h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${stats.execRate}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-gray-500">
            <span>집행: {fmt(stats.totalExecuted)}원</span>
            <span>계획: {fmt(stats.totalPlanned)}원</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">미처리 건</h3>
          <div className="space-y-3">
            <Link href="/changes" className="flex items-center justify-between hover:bg-gray-50 -mx-2 px-2 py-1 rounded-lg">
              <span className="text-sm text-gray-700">변경 신청</span>
              <span className="bg-orange-100 text-orange-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">{stats.pendingChanges}건</span>
            </Link>
            <Link href="/purchases" className="flex items-center justify-between hover:bg-gray-50 -mx-2 px-2 py-1 rounded-lg">
              <span className="text-sm text-gray-700">구매 승인</span>
              <span className="bg-orange-100 text-orange-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">{stats.pendingPurchases}건</span>
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">분야별 분포</h3>
          <div className="space-y-2">
            {stats.byCategory.map((c) => (
              <div key={c.category} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{c.category}</span>
                <span className="font-medium text-gray-900">{c.cnt}개</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Company exec table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">기업별 예산 집행 현황</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-5 py-3 font-medium">기업명</th>
                <th className="text-right px-5 py-3 font-medium">정부지원금</th>
                <th className="text-right px-5 py-3 font-medium">집행액</th>
                <th className="text-right px-5 py-3 font-medium">집행률</th>
                <th className="text-center px-5 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.execByCompany.map((c) => {
                const rate = c.planned > 0 ? Math.round((c.executed / c.planned) * 100) : 0
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <Link href={`/companies/${c.id}`} className="text-blue-600 hover:underline font-medium">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">{fmt(c.gov_support)}원</td>
                    <td className="px-5 py-3 text-right text-gray-700">{fmt(c.executed)}원</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(rate, 100)}%` }} />
                        </div>
                        <span className="text-gray-900 font-medium w-10 text-right">{rate}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[c.status] || 'bg-gray-100 text-gray-800'}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
