'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const statusColors: Record<string, string> = { '검토중': 'bg-orange-100 text-orange-800', '승인': 'bg-green-100 text-green-800', '반려': 'bg-red-100 text-red-800' }

export default function ChangesPage() {
  const supabase = createClient()
  const [changes, setChanges] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data: crs } = await supabase.from('change_requests').select('*, companies(name, agreement_end)').order('created_at', { ascending: false })
    setChanges(crs || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    const note = prompt(action === 'approve' ? '승인 의견을 입력하세요:' : '반려 사유를 입력하세요:')
    if (note === null) return
    await supabase.from('change_requests').update({
      status: action === 'approve' ? '승인' : '반려',
      reviewer_note: note,
      resolved_at: new Date().toISOString()
    }).eq('id', id)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>

  return (
    <div className="space-y-4">
      {changes.length === 0 ? <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">변경 신청 내역이 없습니다</div> :
        changes.map(cr => (
          <div key={cr.id} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <Link href={`/companies/${cr.company_id}`} className="text-blue-600 hover:underline font-medium">{cr.companies?.name}</Link>
                <span className="text-gray-500 text-sm">{cr.type}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[cr.status]}`}>{cr.status}</span>
                <span className="text-xs text-gray-400">{cr.created_at?.slice(0, 10)}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="bg-red-50 rounded-lg p-3"><p className="text-xs text-red-500 mb-1">변경 전</p><p className="text-gray-800">{cr.before_content}</p></div>
              <div className="bg-green-50 rounded-lg p-3"><p className="text-xs text-green-600 mb-1">변경 후</p><p className="text-gray-800">{cr.after_content}</p></div>
            </div>
            <p className="text-sm text-gray-600">사유: {cr.reason}</p>
            {cr.reviewer_note && <p className="text-sm text-gray-500">검토 의견: {cr.reviewer_note}</p>}
            {cr.status === '검토중' && (
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button onClick={() => handleAction(cr.id, 'approve')} className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">승인</button>
                <button onClick={() => handleAction(cr.id, 'reject')} className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">반려</button>
              </div>
            )}
          </div>
        ))
      }
    </div>
  )
}
