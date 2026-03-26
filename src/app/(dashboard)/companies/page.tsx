'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import FileUploadModal from '@/components/FileUploadModal'
import Link from 'next/link'

const statusColors: Record<string, string> = {
  '진행중': 'bg-blue-100 text-blue-800',
  '보완필요': 'bg-yellow-100 text-yellow-800',
  '중단': 'bg-red-100 text-red-800',
  '완료': 'bg-green-100 text-green-800',
}

function fmt(n: number) { return new Intl.NumberFormat('ko-KR').format(n) }

export default function CompaniesPage() {
  const supabase = createClient()
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterRegion, setFilterRegion] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showFileUpload, setShowFileUpload] = useState(false)
  const [selectedCompanyForUpload, setSelectedCompanyForUpload] = useState<{ id: number; name: string } | null>(null)
  const [form, setForm] = useState({
    name: '', item_name: '', representative: '', business_number: '', business_type: '개인',
    address: '', open_date: '', region: '', category: '', total_budget: 0, gov_support: 0,
    matching_fund: 0, matching_type: '현금', agreement_start: '', agreement_end: '',
    employees_current: 0, employees_planned: 0, revenue_prev: 0,
  })
  const [formError, setFormError] = useState('')

  async function load() {
    let query = supabase.from('companies').select('*').order('created_at', { ascending: false })
    if (filterStatus) query = query.eq('status', filterStatus)
    if (filterRegion) query = query.eq('region', filterRegion)
    if (filterCategory) query = query.eq('category', filterCategory)
    if (search) query = query.or(`name.ilike.%${search}%,item_name.ilike.%${search}%,representative.ilike.%${search}%`)
    const { data } = await query
    setCompanies(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filterStatus, filterRegion, filterCategory, search])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (form.gov_support > form.total_budget * 0.8) { setFormError('정부지원금은 총 사업비의 80% 이하여야 합니다'); return }
    if (form.gov_support > 40000000) { setFormError('정부지원금은 최대 4,000만 원입니다'); return }
    if (form.matching_fund < form.total_budget * 0.2) { setFormError('대응자금은 총 사업비의 20% 이상이어야 합니다'); return }

    const { error } = await supabase.from('companies').insert([{ ...form, status: '진행중' }])
    if (error) { setFormError(error.message.includes('unique') ? '이미 등록된 사업자번호입니다' : error.message); return }
    setShowForm(false)
    setForm({ name: '', item_name: '', representative: '', business_number: '', business_type: '개인', address: '', open_date: '', region: '', category: '', total_budget: 0, gov_support: 0, matching_fund: 0, matching_type: '현금', agreement_start: '', agreement_end: '', employees_current: 0, employees_planned: 0, revenue_prev: 0 })
    load()
  }

  const regions = ['서울', '부산', '대구', '인천', '광주', '대전']
  const categories = ['지역가치', '로컬푸드', '지역기반제조', '지역특화관광', '거점브랜드', '디지털문화체험', '자연친화활동']

  return (
    <>
      <FileUploadModal
        isOpen={showFileUpload}
        onClose={() => setShowFileUpload(false)}
        companyId={selectedCompanyForUpload?.id || 0}
        companyName={selectedCompanyForUpload?.name || ''}
        onSuccess={() => {
          setShowFileUpload(false)
          setSelectedCompanyForUpload(null)
        }}
      />
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3">
          <input
            type="text" placeholder="기업명, 아이템, 대표자 검색..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
            <option value="">전체 상태</option>
            {['진행중', '보완필요', '중단', '완료'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
            <option value="">전체 지역</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
            <option value="">전체 분야</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
            + 신규 등록
          </button>
        </div>
      </div>

      {/* Register form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">새 창업기업 등록</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: '기업명*', key: 'name', type: 'text' },
              { label: '아이템명*', key: 'item_name', type: 'text' },
              { label: '대표자*', key: 'representative', type: 'text' },
              { label: '사업자번호', key: 'business_number', type: 'text' },
              { label: '주소', key: 'address', type: 'text' },
              { label: '개업일', key: 'open_date', type: 'date' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                <input type={f.type} value={(form as any)[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" required={f.label.includes('*')} />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">지역*</label>
              <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700" required>
                <option value="">선택</option>
                {regions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">분야*</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700" required>
                <option value="">선택</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사업유형</label>
              <select value={form.business_type} onChange={e => setForm({ ...form, business_type: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
                <option value="개인">개인</option><option value="법인">법인</option>
              </select>
            </div>
            {[
              { label: '총 사업비*', key: 'total_budget' },
              { label: '정부지원금*', key: 'gov_support' },
              { label: '대응자금*', key: 'matching_fund' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                <input type="number" value={(form as any)[f.key]} onChange={e => setForm({ ...form, [f.key]: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" required />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">협약 시작일</label>
              <input type="date" value={form.agreement_start} onChange={e => setForm({ ...form, agreement_start: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">협약 종료일</label>
              <input type="date" value={form.agreement_end} onChange={e => setForm({ ...form, agreement_end: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" />
            </div>
            <div className="md:col-span-3 space-y-3">
              {formError && <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg">{formError}</div>}
              <div className="flex gap-2">
                <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">등록</button>
                <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">취소</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">기업명</th>
                  <th className="text-left px-5 py-3 font-medium">아이템</th>
                  <th className="text-left px-5 py-3 font-medium">대표자</th>
                  <th className="text-left px-5 py-3 font-medium">지역</th>
                  <th className="text-left px-5 py-3 font-medium">분야</th>
                  <th className="text-right px-5 py-3 font-medium">정부지원금</th>
                  <th className="text-center px-5 py-3 font-medium">상태</th>
                  <th className="text-center px-5 py-3 font-medium">사업계획서</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {companies.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3"><Link href={`/companies/${c.id}`} className="text-blue-600 hover:underline font-medium">{c.name}</Link></td>
                    <td className="px-5 py-3 text-gray-700 max-w-[200px] truncate">{c.item_name}</td>
                    <td className="px-5 py-3 text-gray-700">{c.representative}</td>
                    <td className="px-5 py-3 text-gray-700">{c.region}</td>
                    <td className="px-5 py-3 text-gray-700">{c.category}</td>
                    <td className="px-5 py-3 text-right text-gray-700">{fmt(c.gov_support)}원</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[c.status] || 'bg-gray-100 text-gray-800'}`}>{c.status}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => {
                          setSelectedCompanyForUpload({ id: c.id, name: c.name })
                          setShowFileUpload(true)
                        }}
                        className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition"
                      >
                        📄 업로드
                      </button>
                    </td>
                  </tr>
                ))}
                {companies.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-gray-400">등록된 기업이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
