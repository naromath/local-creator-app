'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

function fmt(n: number) { return new Intl.NumberFormat('ko-KR').format(n) }

type Tab = '검토중' | '승인' | '반려'
const tabMeta: { key: Tab; label: string; color: string }[] = [
  { key: '검토중', label: '검토중', color: 'orange' },
  { key: '승인', label: '승인', color: 'green' },
  { key: '반려', label: '반려', color: 'red' },
]

const statusBadge: Record<string, string> = {
  '검토중': 'bg-orange-100 text-orange-800',
  '승인': 'bg-green-100 text-green-800',
  '반려': 'bg-red-100 text-red-800',
}

const changeTypes = ['예산 변경', '사업 내용 변경', '기간 변경', '대표자 변경', '사업장 변경', '기타']

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

export default function ChangesPage() {
  const supabase = createClient()
  const [changes, setChanges] = useState<any[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [changeFiles, setChangeFiles] = useState<Record<number, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('검토중')

  // 모달 상태
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    company_id: '', type: '예산 변경', before_content: '', after_content: '', reason: '',
  })
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    const [cr, c] = await Promise.all([
      supabase.from('change_requests').select('*, companies(name, agreement_end)').order('created_at', { ascending: false }),
      supabase.from('companies').select('id, name').order('name'),
    ])
    const list = cr.data || []
    setChanges(list)
    setCompanies(c.data || [])

    // 첨부파일 로드
    const ids = list.map((x: any) => x.id)
    if (ids.length > 0) {
      const { data: fileData } = await supabase.from('change_request_files').select('*').in('change_request_id', ids)
      const grouped: Record<number, any[]> = {}
      for (const f of fileData || []) {
        if (!grouped[f.change_request_id]) grouped[f.change_request_id] = []
        grouped[f.change_request_id].push(f)
      }
      setChangeFiles(grouped)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = changes.filter(c => c.status === tab)

  function openModal() {
    setForm({ company_id: '', type: '예산 변경', before_content: '', after_content: '', reason: '' })
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
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.company_id) { setFormError('기업을 선택해주세요'); return }
    if (!form.before_content.trim()) { setFormError('변경 전 내용을 입력해주세요'); return }
    if (!form.after_content.trim()) { setFormError('변경 후 내용을 입력해주세요'); return }
    if (!form.reason.trim()) { setFormError('변경 사유를 입력해주세요'); return }

    setSubmitting(true)
    try {
      const { data: cr, error } = await supabase.from('change_requests').insert([{
        company_id: Number(form.company_id),
        type: form.type,
        before_content: form.before_content.trim(),
        after_content: form.after_content.trim(),
        reason: form.reason.trim(),
        status: '검토중',
      }]).select('id').single()

      if (error) throw error

      // 파일 업로드
      if (cr && files.length > 0) {
        for (const file of files) {
          const ts = Date.now() + Math.floor(Math.random() * 1000)
          const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
          const storagePath = `${cr.id}/${ts}.${ext}`

          const { error: uploadErr } = await supabase.storage
            .from('change-documents')
            .upload(storagePath, file, { upsert: false })

          if (!uploadErr) {
            await supabase.from('change_request_files').insert([{
              change_request_id: cr.id,
              file_name: file.name,
              file_path: storagePath,
              file_size: file.size,
              file_type: ext,
            }])
          }
        }
      }

      setShowModal(false)
      setTab('검토중')
      load()
    } catch (err: any) {
      setFormError(err.message || '저장 중 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    const msg = action === 'approve' ? '승인 의견을 입력하세요:' : '반려 사유를 입력하세요:'
    const note = prompt(msg)
    if (note === null) return
    await supabase.from('change_requests').update({
      status: action === 'approve' ? '승인' : '반려',
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
            const cnt = changes.filter(c => c.status === t.key).length
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
          변경 요청
        </button>
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-10 h-10 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <p className="text-sm">
              {tab === '검토중' ? '검토 대기 중인 변경 신청이 없습니다' :
               tab === '승인' ? '승인된 변경 신청이 없습니다' : '반려된 변경 신청이 없습니다'}
            </p>
            {tab === '검토중' && (
              <button onClick={openModal} className="mt-3 text-sm text-blue-600 hover:underline">+ 변경 요청 등록하기</button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(cr => {
              const crFiles = changeFiles[cr.id] || []
              return (
                <div key={cr.id} className="p-4 hover:bg-gray-50 transition">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* 상단 정보 */}
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge[cr.status]}`}>{cr.status}</span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{cr.type}</span>
                        <Link href={`/companies/${cr.company_id}`} className="text-sm text-blue-600 hover:underline font-medium">{cr.companies?.name}</Link>
                        <span className="text-xs text-gray-400">{cr.created_at?.slice(0, 10)}</span>
                        {cr.resolved_at && <span className="text-xs text-gray-400">처리: {cr.resolved_at?.slice(0, 10)}</span>}
                      </div>

                      {/* 변경 전/후 비교 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                        <div className="bg-red-50 rounded-lg p-3 border border-red-100">
                          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1">변경 전</p>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{cr.before_content}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                          <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wider mb-1">변경 후</p>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{cr.after_content}</p>
                        </div>
                      </div>

                      {/* 사유 */}
                      <div className="mt-2 text-sm text-gray-600">
                        <span className="font-medium text-gray-700">사유:</span> {cr.reason}
                      </div>

                      {/* 첨부 파일 */}
                      {crFiles.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {crFiles.map((f: any) => {
                            const ext = f.file_name?.split('.').pop()?.toLowerCase() || 'file'
                            const url = `https://ztwvlcnsqfmogmekrtki.supabase.co/storage/v1/object/public/change-documents/${f.file_path}`
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
                      {cr.reviewer_note && (
                        <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                          <span className="font-medium text-gray-700">검토 의견:</span> {cr.reviewer_note}
                        </div>
                      )}
                    </div>

                    {/* 액션 버튼 */}
                    {cr.status === '검토중' && (
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => handleAction(cr.id, 'approve')}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition">승인</button>
                        <button onClick={() => handleAction(cr.id, 'reject')}
                          className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition">반려</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 통계 요약 */}
      <div className="grid grid-cols-3 gap-3">
        {tabMeta.map(t => {
          const items = changes.filter(c => c.status === t.key)
          return (
            <div key={t.key} className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-blue-200 transition" onClick={() => setTab(t.key)}>
              <p className="text-xs text-gray-500 mb-1">{t.label}</p>
              <p className="text-xl font-bold text-gray-900">{items.length}<span className="text-sm font-normal text-gray-400 ml-0.5">건</span></p>
            </div>
          )
        })}
      </div>

      {/* ===== 변경 요청 모달 ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 배경 오버레이 */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />

          {/* 모달 본체 */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">변경 요청</h2>
                <p className="text-xs text-gray-500 mt-0.5">변경 내용과 사유, 관련 서류를 첨부해주세요</p>
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

                {/* 변경 유형 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">변경 유형</label>
                  <div className="flex flex-wrap gap-2">
                    {changeTypes.map(t => (
                      <button key={t} type="button"
                        onClick={() => setForm({ ...form, type: t })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                          form.type === t
                            ? 'bg-blue-50 border-blue-300 text-blue-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 변경 전 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    변경 전 내용 <span className="text-red-500">*</span>
                  </label>
                  <textarea value={form.before_content}
                    onChange={e => setForm({ ...form, before_content: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="현재 내용을 입력하세요" required />
                </div>

                {/* 변경 후 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    변경 후 내용 <span className="text-red-500">*</span>
                  </label>
                  <textarea value={form.after_content}
                    onChange={e => setForm({ ...form, after_content: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="변경할 내용을 입력하세요" required />
                </div>

                {/* 변경 사유 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    변경 사유 <span className="text-red-500">*</span>
                  </label>
                  <textarea value={form.reason}
                    onChange={e => setForm({ ...form, reason: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="변경 사유를 입력하세요" required />
                </div>

                {/* 서류 첨부 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">서류 첨부</label>
                  <p className="text-xs text-gray-400 mb-2">변경 신청서, 근거 서류 등을 첨부하세요</p>

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
                      변경 요청 제출
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
