'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

function fmt(n: number) { return new Intl.NumberFormat('ko-KR').format(n) }
const statusColors: Record<string, string> = { '검토중': 'bg-orange-100 text-orange-800', '승인': 'bg-green-100 text-green-800', '반려': 'bg-red-100 text-red-800' }

export default function PurchasesPage() {
  const supabase = createClient()
  const [purchases, setPurchases] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase.from('purchase_approvals').select('*, companies(name)').order('created_at', { ascending: false })
    setPurchases(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    const note = prompt(action === 'approve' ? '승인 의견:' : '반려 사유:')
    if (note === null) return
    await supabase.from('purchase_approvals').update({
      status: action === 'approve' ? '승인' : '반려',
      reviewer_note: note,
      resolved_at: new Date().toISOString()
    }).eq('id', id)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-5 py-3 font-medium">기업명</th>
              <th className="text-left px-5 py-3 font-medium">품목</th>
              <th className="text-right px-5 py-3 font-medium">금액</th>
              <th className="text-left px-5 py-3 font-medium">목적</th>
              <th className="text-center px-5 py-3 font-medium">견적서</th>
              <th className="text-center px-5 py-3 font-medium">상태</th>
              <th className="text-center px-5 py-3 font-medium">처리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {purchases.map(pa => (
              <tr key={pa.id} className="hover:bg-gray-50">
                <td className="px-5 py-3"><Link href={`/companies/${pa.company_id}`} className="text-blue-600 hover:underline font-medium">{pa.companies?.name}</Link></td>
                <td className="px-5 py-3 text-gray-900 font-medium">{pa.item_name}</td>
                <td className="px-5 py-3 text-right text-gray-700">{fmt(pa.amount)}원</td>
                <td className="px-5 py-3 text-gray-700 max-w-[200px] truncate">{pa.purpose}</td>
                <td className="px-5 py-3 text-center text-gray-700">{pa.quote_count}건 {pa.quote_attached ? '(첨부)' : ''}</td>
                <td className="px-5 py-3 text-center"><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[pa.status]}`}>{pa.status}</span></td>
                <td className="px-5 py-3 text-center">
                  {pa.status === '검토중' ? (
                    <div className="flex justify-center gap-1">
                      <button onClick={() => handleAction(pa.id, 'approve')} className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">승인</button>
                      <button onClick={() => handleAction(pa.id, 'reject')} className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">반려</button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">{pa.reviewer_note || '-'}</span>
                  )}
                </td>
              </tr>
            ))}
            {purchases.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400">구매 승인 내역이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
