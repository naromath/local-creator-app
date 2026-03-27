'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

function fmt(n: number) { return new Intl.NumberFormat('ko-KR').format(n) }

type Tab = '요청' | '승인' | '완료' | '반려'
const tabMeta: { key: Tab; label: string; color: string }[] = [
  { key: '요청', label: '구매 요청', color: 'orange' },
  { key: '승인', label: '구매 승인', color: 'blue' },
  { key: '완료', label: '구매 완료', color: 'green' },
  { key: '반려', label: '반려', color: 'red' },
]

const statusBadge: Record<string, string> = {
  '요청': 'bg-orange-100 text-orange-800',
  '승인': 'bg-blue-100 text-blue-800',
  '완료': 'bg-green-100 text-green-800',
  '반려': 'bg-red-100 text-red-800',
}

export default function PurchasesPage() {
  const supabase = createClient()
  const [purchases, setPurchases] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [purchaseFiles, setPurchaseFiles] = useState<Record<number, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('요청')

  // 신규 요청 폼
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ company_id: '', item_name: '', amount: 0, purpose: '', quote_count: 0 })
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    const [p, c] = await Promise.all([
      supabase.from('purchase_approvals').select('*, companies(name)').order('created_at', { ascending: false }),
      supabase.from('companies').select('id, name').order('name'),
    ])
    const list = p.data || []
    setPurchases(list)
    setCompanies(c.data || [])

    // 첨부파일 로드
    const ids = list.map((x: any) => x.id)
    if (ids.length > 0) {
      const { data: fileData } = await supabase.from('purchase_files').select('*').in('purchase_id', ids)
      const grouped: Record<number, any[]> = {}
      for (const f of fileData || []) {
        if (!grouped[f.purchase_id]) grouped[f.purchase_id] = []
        grouped[f.purchase_id].push(f)
      }
      setPurchaseFiles(grouped)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = purchases.filter(p => p.status === tab)

  // 신규 구매 요청
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.company_id) { setFormError('기업을 선택해주세요'); return }
    if (!form.item_name.trim()) { setFormError('품목명을 입력해주세요'); return }
    if (form.amount <= 0) { setFormError('금액을 입력해주세요'); return }

    setSubmitting(true)
    try {
      const { data: pa, error } = await supabase.from('purchase_approvals').insert([{
        company_id: Number(form.company_id),
        item_name: form.item_name,
        amount: form.amount,
        purpose: form.purpose,
        quote_count: form.quote_count,
        quote_attached: files.length > 0,
        status: '요청',
      }]).select('id').single()

      if (error) throw error

      // 파일 업로드
      if (pa && files.length > 0) {
        for (const file of files) {
          const ts = Date.now()
          const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
          const storagePath = `${pa.id}/${ts}.${ext}`

          const { error: uploadErr } = await supabase.storage
            .from('purchase-documents')
            .upload(storagePath, file, { upsert: false })

          if (!uploadErr) {
            await supabase.from('purchase_files').insert([{
              purchase_id: pa.id,
              file_name: file.name,
              file_path: storagePath,
              file_size: file.size,
              file_type: ext,
            }])
          }
        }
      }

      setShowForm(false)
      setForm({ company_id: '', item_name: '', amount: 0, purpose: '', quote_count: 0 })
      setFiles([])
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (err: any) {
      setFormError(err.message || '저장 오류')
    } finally {
      setSubmitting(false)
    }
  }

  // 상태 변경
  const handleStatusChange = async (id: number, newStatus: '승인' | '완료' | '반려') => {
    const msg = newStatus === '반려' ? '반려 사유를 입력하세요:' : (newStatus === '승인' ? '승인 의견 (선택):' : '완료 메모 (선택):')
    const note = prompt(msg)
    if (note === null) return
    await supabase.from('purchase_approvals').update({
      status: newStatus,
      reviewer_note: note || null,
      resolved_at: new Date().toISOString(),
    }).eq('id', id)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>

  return (
    <div className="space-y-4">
      {/* 상단: 탭 + 신규 버튼 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {tabMeta.map(t => {
            const cnt = purchases.filter(p => p.status === t.key).length
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {t.label} <span className="ml-1 text-xs text-gray-400">{cnt}</span>
              </button>
            )
          })}
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
          + 구매 요청
        </button>
      </div>

      {/* 신규 요청 폼 */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">새 구매 요청</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">기업 *</label>
              <select value={form.company_id} onChange={e => setForm({ ...form, company_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700" required>
                <option value="">선택</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">품목명 *</label>
              <input type="text" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" placeholder="예: 노트북, 원재료" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">금액 (원) *</label>
              <input type="number" value={form.amount || ''} onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" placeholder="0" required />
              {form.amount > 0 && <p className="text-xs text-gray-500 mt-0.5">{fmt(form.amount)}원</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">견적서 수</label>
              <input type="number" value={form.quote_count || ''} onChange={e => setForm({ ...form, quote_count: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" min={0} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">구매 목적/용도</label>
              <textarea value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" placeholder="구매 목적 설명" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">서류 첨부 (견적서, 사양서, 카탈로그 등)</label>
              <input ref={fileRef} type="file" multiple onChange={e => setFiles(Array.from(e.target.files || []))}
                className="w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium file:text-sm file:cursor-pointer"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" />
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-medium">{f.name.split('.').pop()?.toUpperCase()}</span>
                      <span className="truncate">{f.name}</span>
                      <span className="text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                      <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {formError && <p className="text-red-600 text-sm">{formError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {submitting ? '제출 중...' : '구매 요청 제출'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setFormError('') }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">취소</button>
          </div>
        </form>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            {tab === '요청' ? '대기 중인 구매 요청이 없습니다' :
             tab === '승인' ? '승인된 구매 건이 없습니다' :
             tab === '완료' ? '완료된 구매 건이 없습니다' : '반려된 건이 없습니다'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(pa => {
              const paFiles = purchaseFiles[pa.id] || []
              return (
                <div key={pa.id} className="p-4 hover:bg-gray-50 transition">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {/* 좌측: 메인 정보 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge[pa.status]}`}>{pa.status}</span>
                        <span className="font-semibold text-gray-900">{pa.item_name}</span>
                        <span className="text-sm text-blue-600 font-bold">{fmt(pa.amount)}원</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <Link href={`/companies/${pa.company_id}`} className="text-blue-600 hover:underline">{pa.companies?.name}</Link>
                        {pa.purpose && <span>목적: {pa.purpose}</span>}
                        <span>견적서 {pa.quote_count || 0}건</span>
                        <span>{pa.created_at?.slice(0, 10)}</span>
                      </div>

                      {/* 첨부 파일 */}
                      {paFiles.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {paFiles.map((f: any) => (
                            <a key={f.id}
                              href={`https://ztwvlcnsqfmogmekrtki.supabase.co/storage/v1/object/public/purchase-documents/${f.file_path}`}
                              target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-700 hover:bg-gray-200 transition">
                              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                              {f.file_name}
                            </a>
                          ))}
                        </div>
                      )}

                      {/* 심사 의견 */}
                      {pa.reviewer_note && (
                        <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded px-2.5 py-1.5">
                          <span className="font-medium">심사 의견:</span> {pa.reviewer_note}
                        </div>
                      )}
                    </div>

                    {/* 우측: 액션 버튼 */}
                    <div className="flex gap-1.5 shrink-0">
                      {tab === '요청' && (
                        <>
                          <button onClick={() => handleStatusChange(pa.id, '승인')}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">승인</button>
                          <button onClick={() => handleStatusChange(pa.id, '반려')}
                            className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100">반려</button>
                        </>
                      )}
                      {tab === '승인' && (
                        <button onClick={() => handleStatusChange(pa.id, '완료')}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">구매 완료 처리</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 통계 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tabMeta.map(t => {
          const items = purchases.filter(p => p.status === t.key)
          const total = items.reduce((s, p) => s + (p.amount || 0), 0)
          return (
            <div key={t.key} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">{t.label}</p>
              <p className="text-lg font-bold text-gray-900">{items.length}<span className="text-sm font-normal text-gray-500">건</span></p>
              <p className="text-xs text-gray-500">{fmt(total)}원</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
