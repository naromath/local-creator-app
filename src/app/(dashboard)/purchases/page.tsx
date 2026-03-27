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

const fileIconColor: Record<string, string> = {
  pdf: 'text-red-500',
  doc: 'text-blue-600', docx: 'text-blue-600',
  xls: 'text-green-600', xlsx: 'text-green-600',
  ppt: 'text-orange-500', pptx: 'text-orange-500',
  jpg: 'text-purple-500', jpeg: 'text-purple-500', png: 'text-purple-500',
}

function FileIcon({ ext }: { ext: string }) {
  const color = fileIconColor[ext.toLowerCase()] || 'text-gray-500'
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[9px] font-bold bg-gray-100 ${color} shrink-0`}>
      {ext.toUpperCase().slice(0, 3)}
    </span>
  )
}

export default function PurchasesPage() {
  const supabase = createClient()
  const [purchases, setPurchases] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [purchaseFiles, setPurchaseFiles] = useState<Record<number, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('요청')

  // 모달 상태
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ company_id: '', item_name: '', amount: '', purpose: '', quote_count: '' })
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

  function openModal() {
    setForm({ company_id: '', item_name: '', amount: '', purpose: '', quote_count: '' })
    setFiles([])
    setFormError('')
    setShowModal(true)
  }

  function closeModal() {
    if (submitting) return
    setShowModal(false)
    setFormError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || [])
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size))
      const newOnes = selected.filter(f => !existing.has(f.name + f.size))
      return [...prev, ...newOnes]
    })
    // input 초기화 (같은 파일 다시 선택 가능하도록)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.company_id) { setFormError('기업을 선택해주세요'); return }
    if (!form.item_name.trim()) { setFormError('품목명을 입력해주세요'); return }
    const amt = Number(form.amount)
    if (!amt || amt <= 0) { setFormError('금액을 올바르게 입력해주세요'); return }

    setSubmitting(true)
    try {
      const { data: pa, error } = await supabase.from('purchase_approvals').insert([{
        company_id: Number(form.company_id),
        item_name: form.item_name.trim(),
        amount: amt,
        purpose: form.purpose.trim() || null,
        quote_count: Number(form.quote_count) || 0,
        quote_attached: files.length > 0,
        status: '요청',
      }]).select('id').single()

      if (error) throw error

      if (pa && files.length > 0) {
        for (const file of files) {
          const ts = Date.now() + Math.floor(Math.random() * 1000)
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

      setShowModal(false)
      setTab('요청')
      load()
    } catch (err: any) {
      setFormError(err.message || '저장 중 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  )

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
                {t.label}
                {cnt > 0 && <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>{cnt}</span>}
              </button>
            )
          })}
        </div>
        <button onClick={openModal}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition shadow-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          구매 요청
        </button>
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-10 h-10 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">
              {tab === '요청' ? '대기 중인 구매 요청이 없습니다' :
               tab === '승인' ? '승인된 구매 건이 없습니다' :
               tab === '완료' ? '완료된 구매 건이 없습니다' : '반려된 건이 없습니다'}
            </p>
            {tab === '요청' && (
              <button onClick={openModal} className="mt-3 text-sm text-blue-600 hover:underline">+ 구매 요청 등록하기</button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(pa => {
              const paFiles = purchaseFiles[pa.id] || []
              return (
                <div key={pa.id} className="p-4 hover:bg-gray-50 transition">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge[pa.status]}`}>{pa.status}</span>
                        <span className="font-semibold text-gray-900">{pa.item_name}</span>
                        <span className="text-sm text-blue-600 font-bold">{fmt(pa.amount)}원</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <Link href={`/companies/${pa.company_id}`} className="text-blue-600 hover:underline font-medium">{pa.companies?.name}</Link>
                        {pa.purpose && <span>목적: {pa.purpose}</span>}
                        {pa.quote_count > 0 && <span>견적서 {pa.quote_count}건</span>}
                        <span>{pa.created_at?.slice(0, 10)}</span>
                        {pa.resolved_at && <span>처리: {pa.resolved_at?.slice(0, 10)}</span>}
                      </div>

                      {/* 첨부 파일 */}
                      {paFiles.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {paFiles.map((f: any) => {
                            const ext = f.file_name?.split('.').pop()?.toLowerCase() || 'file'
                            const url = `https://ztwvlcnsqfmogmekrtki.supabase.co/storage/v1/object/public/purchase-documents/${f.file_path}`
                            return (
                              <a key={f.id} href={url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition">
                                <FileIcon ext={ext} />
                                <span className="max-w-[120px] truncate">{f.file_name}</span>
                                {f.file_size && <span className="text-gray-400 shrink-0">{(f.file_size / 1024).toFixed(0)}KB</span>}
                              </a>
                            )
                          })}
                        </div>
                      )}

                      {/* 심사 의견 */}
                      {pa.reviewer_note && (
                        <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                          <span className="font-medium text-gray-700">심사 의견:</span> {pa.reviewer_note}
                        </div>
                      )}
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex gap-1.5 shrink-0">
                      {tab === '요청' && (
                        <>
                          <button onClick={() => handleStatusChange(pa.id, '승인')}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition">승인</button>
                          <button onClick={() => handleStatusChange(pa.id, '반려')}
                            className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition">반려</button>
                        </>
                      )}
                      {tab === '승인' && (
                        <button onClick={() => handleStatusChange(pa.id, '완료')}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition">구매 완료</button>
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
            <div key={t.key} className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-blue-200 transition" onClick={() => setTab(t.key)}>
              <p className="text-xs text-gray-500 mb-1">{t.label}</p>
              <p className="text-xl font-bold text-gray-900">{items.length}<span className="text-sm font-normal text-gray-400 ml-0.5">건</span></p>
              <p className="text-xs text-gray-500 mt-0.5">{fmt(total)}원</p>
            </div>
          )
        })}
      </div>

      {/* ===== 구매 요청 모달 ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 배경 오버레이 */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />

          {/* 모달 본체 */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">구매 요청</h2>
                <p className="text-xs text-gray-500 mt-0.5">구매할 물품 정보와 관련 서류를 첨부해주세요</p>
              </div>
              <button onClick={closeModal} disabled={submitting}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 폼 내용 (스크롤 가능) */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

                {/* 기업 선택 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    기업 <span className="text-red-500">*</span>
                  </label>
                  <select value={form.company_id}
                    onChange={e => setForm({ ...form, company_id: e.target.value })}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required>
                    <option value="">기업을 선택하세요</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* 품목명 + 금액 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      품목명 <span className="text-red-500">*</span>
                    </label>
                    <input type="text" value={form.item_name}
                      onChange={e => setForm({ ...form, item_name: e.target.value })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="예: 노트북, 원재료" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      금액 (원) <span className="text-red-500">*</span>
                    </label>
                    <input type="number" value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0" min={0} required />
                    {Number(form.amount) > 0 && (
                      <p className="text-xs text-blue-600 mt-1 font-medium">{fmt(Number(form.amount))}원</p>
                    )}
                  </div>
                </div>

                {/* 구매 목적 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">구매 목적 / 용도</label>
                  <textarea value={form.purpose}
                    onChange={e => setForm({ ...form, purpose: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="구매 목적을 간략히 설명해주세요" />
                </div>

                {/* 견적서 수 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">견적서 수</label>
                  <input type="number" value={form.quote_count}
                    onChange={e => setForm({ ...form, quote_count: e.target.value })}
                    className="w-32 px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0" min={0} />
                </div>

                {/* 서류 첨부 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">서류 첨부</label>
                  <p className="text-xs text-gray-400 mb-2">견적서, 사양서, 카탈로그, 승인 관련 서류 등을 첨부하세요</p>

                  {/* 드롭존 스타일 업로드 버튼 */}
                  <label className="flex flex-col items-center justify-center w-full py-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition group">
                    <svg className="w-8 h-8 text-gray-300 group-hover:text-blue-400 transition mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-gray-500 group-hover:text-blue-600">파일을 클릭하여 선택</span>
                    <span className="text-xs text-gray-400 mt-0.5">PDF, Word, Excel, PowerPoint, 이미지</span>
                    <input ref={fileRef} type="file" multiple className="hidden"
                      onChange={handleFileChange}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" />
                  </label>

                  {/* 선택된 파일 목록 */}
                  {files.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {files.map((f, i) => {
                        const ext = f.name.split('.').pop()?.toLowerCase() || 'file'
                        return (
                          <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <FileIcon ext={ext} />
                            <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
                            <span className="text-xs text-gray-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                            <button type="button"
                              onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                              className="p-0.5 text-gray-300 hover:text-red-500 transition shrink-0">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 오류 메시지 */}
                {formError && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formError}
                  </div>
                )}
              </div>

              {/* 하단 버튼 */}
              <div className="flex gap-2 px-6 py-4 border-t border-gray-100 shrink-0 bg-gray-50 rounded-b-2xl">
                <button type="submit" disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition">
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      제출 중...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      구매 요청 제출
                    </>
                  )}
                </button>
                <button type="button" onClick={closeModal} disabled={submitting}
                  className="px-5 py-2.5 bg-white text-gray-600 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition">
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
