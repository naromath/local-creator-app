'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const gradeColors: Record<string, string> = { '계속': 'bg-blue-100 text-blue-800', '적정': 'bg-green-100 text-green-800', '보완': 'bg-yellow-100 text-yellow-800', '중단': 'bg-red-100 text-red-800', '부적정': 'bg-red-100 text-red-800' }

export default function InspectionsPage() {
  const supabase = createClient()
  const [inspections, setInspections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('inspections').select('*, companies(name, region, category)').order('inspected_at', { ascending: false })
      setInspections(data || [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-5 py-3 font-medium">기업명</th>
              <th className="text-left px-5 py-3 font-medium">지역</th>
              <th className="text-left px-5 py-3 font-medium">분야</th>
              <th className="text-center px-5 py-3 font-medium">유형</th>
              <th className="text-center px-5 py-3 font-medium">등급</th>
              <th className="text-left px-5 py-3 font-medium">비고</th>
              <th className="text-left px-5 py-3 font-medium">점검자</th>
              <th className="text-left px-5 py-3 font-medium">날짜</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {inspections.map(i => (
              <tr key={i.id} className="hover:bg-gray-50">
                <td className="px-5 py-3"><Link href={`/companies/${i.company_id}`} className="text-blue-600 hover:underline font-medium">{i.companies?.name}</Link></td>
                <td className="px-5 py-3 text-gray-700">{i.companies?.region}</td>
                <td className="px-5 py-3 text-gray-700">{i.companies?.category}</td>
                <td className="px-5 py-3 text-center text-gray-700">{i.type}</td>
                <td className="px-5 py-3 text-center"><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${gradeColors[i.grade] || 'bg-gray-100 text-gray-800'}`}>{i.grade}</span></td>
                <td className="px-5 py-3 text-gray-700 max-w-[200px] truncate">{i.notes}</td>
                <td className="px-5 py-3 text-gray-700">{i.inspector}</td>
                <td className="px-5 py-3 text-gray-700">{i.inspected_at?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
