'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  regions: string[]
  categories: string[]
}

type Step = 'upload' | 'analyzing' | 'review'

const defaultForm = {
  name: '', item_name: '', representative: '', business_number: '', business_type: '개인',
  address: '', open_date: '', region: '', category: '', total_budget: 0, gov_support: 0,
  matching_fund: 0, matching_type: '현금', agreement_start: '', agreement_end: '',
  employees_current: 0, employees_planned: 0, revenue_prev: 0,
}

function fmt(n: number) { return new Intl.NumberFormat('ko-KR').format(n) }

export default function BusinessPlanRegisterModal({ isOpen, onClose, onSuccess, regions, categories }: Props) {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ ...defaultForm })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [extractedFields, setExtractedFields] = useState<string[]>([]) // 자동 추출된 필드 목록
  const [rawPreview, setRawPreview] = useState('')
  const [extractedText, setExtractedText] = useState('') // 원본 추출 텍스트
  const [analysisWarning, setAnalysisWarning] = useState('') // 분석 중 경고 메시지

  const resetAll = () => {
    setStep('upload')
    setFile(null)
    setNotes('')
    setError('')
    setForm({ ...defaultForm })
    setFormError('')
    setSaving(false)
    setExtractedFields([])
    setRawPreview('')
    setExtractedText('')
    setAnalysisWarning('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    resetAll()
    onClose()
  }

  // 파일 선택
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('파일 크기는 50MB 이하여야 합니다')
      return
    }

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]
    const allowedExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
    const extension = selectedFile.name.split('.').pop()?.toLowerCase() || ''
    const isAllowedType = allowedTypes.includes(selectedFile.type) || allowedExtensions.includes(extension)

    if (!isAllowedType) {
      setError('PDF, Word, Excel, PowerPoint 파일만 업로드 가능합니다')
      return
    }

    setFile(selectedFile)
    setError('')
    setAnalysisWarning('')
  }

  // Step 1 → Step 2: 파일 업로드 후 파싱
  const handleAnalyze = async () => {
    if (!file) { setError('파일을 선택해주세요'); return }

    setStep('analyzing')
    setError('')
    setAnalysisWarning('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/parse-business-plan', {
        method: 'POST',
        body: formData,
      })

      console.log('API 응답 상태:', response.status)
      console.log('Content-Type:', response.headers.get('content-type'))

      // HTML 오류 페이지 방어 처리
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        console.error('API가 JSON이 아닌 응답 반환 (상태: ' + response.status + ')')
        const textResponse = await response.text()
        console.error('응답 내용:', textResponse.substring(0, 500))
        
        // JSON이 아니어도 폼 입력 단계로 이동 (직접 입력 가능)
        setForm({ ...defaultForm })
        setExtractedFields([])
        setRawPreview('')
        setError('API 응답 오류 발생. 항목을 직접 입력해주세요.')
        setAnalysisWarning('로그인 상태를 확인하거나 잠시 후 다시 시도해주세요.')
        setStep('review')
        return
      }

      const data = await response.json()
      console.log('파싱 결과:', { success: data.success, fieldsCount: Object.keys(data.extractedData || {}).length })

      // 경고가 있어도 폼으로 이동 (직접 입력 가능)
      if (data.warning) {
        console.warn('파싱 경고:', data.warning)
        setAnalysisWarning(data.warning)
      }

      if (data.error && !data.extractedData) {
        // 에러이지만 폼으로 이동하여 직접 입력 가능하게
        setForm({ ...defaultForm })
        setExtractedFields([])
        setError(data.error)
        setStep('review')
        return
      }

      // 추출된 데이터로 폼 채우기
      const extracted = data.extractedData || {}
      const filledFields: string[] = []
      const newForm = { ...defaultForm }

      for (const [key, value] of Object.entries(extracted)) {
        if (value !== undefined && value !== null && value !== '' && value !== 0) {
          (newForm as any)[key] = value
          filledFields.push(key)
        }
      }

      setForm(newForm)
      setExtractedFields(filledFields)
      setRawPreview(data.rawTextPreview || '')
      setExtractedText(data.rawTextPreview || '') // 원본 텍스트 저장
      setStep('review')
    } catch (err: any) {
      console.error('분석 오류:', err)
      // 오류가 발생해도 폼 입력 단계로 이동 (직접 입력 가능)
      setForm({ ...defaultForm })
      setExtractedFields([])
      setError('파일 분석 중 오류가 발생했습니다. 항목을 직접 입력해주세요.')
      setAnalysisWarning(err?.message || '')
      setStep('review')
    }
  }

  // 추출 결과를 파일로 저장
  const handleSaveExtraction = async () => {
    try {
      const response = await fetch('/api/save-extraction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file?.name,
          extractedText,
          extractedData: form,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setFormError(`저장 실패: ${data.error}`)
        return
      }

      setFormError(`✓ 추출 결과 저장 완료!\n- JSON: ${data.files.json}\n- Markdown: ${data.files.markdown}\n- CSV: ${data.files.csv}`)
      console.log('저장 완료:', data)
    } catch (err: any) {
      setFormError(`저장 중 오류: ${err.message}`)
    }
  }

  // Step 3: 최종 저장
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    // 유효성 검사
    if (!form.name.trim()) { setFormError('기업명을 입력해주세요'); return }
    if (!form.item_name.trim()) { setFormError('아이템명을 입력해주세요'); return }
    if (!form.representative.trim()) { setFormError('대표자를 입력해주세요'); return }
    if (!form.region) { setFormError('지역을 선택해주세요'); return }
    if (!form.category) { setFormError('분야를 선택해주세요'); return }
    if (form.total_budget <= 0) { setFormError('총 사업비를 입력해주세요'); return }
    if (form.gov_support > form.total_budget * 0.8) { setFormError('정부지원금은 총 사업비의 80% 이하여야 합니다'); return }
    if (form.gov_support > 40000000) { setFormError('정부지원금은 최대 4,000만 원입니다'); return }
    if (form.matching_fund < form.total_budget * 0.2) { setFormError('대응자금은 총 사업비의 20% 이상이어야 합니다'); return }

    setSaving(true)

    try {
      // 1) 기업 등록
      const { data: company, error: insertError } = await supabase
        .from('companies')
        .insert([{ ...form, status: '진행중' }])
        .select('id')
        .single()

      if (insertError) {
        if (insertError.message.includes('unique')) throw new Error('이미 등록된 사업자번호입니다')
        throw insertError
      }

      // 2) 사업계획서 파일을 Supabase Storage에 업로드
      if (file && company) {
        const timestamp = Date.now()
        const filePath = `business-plans/${company.id}/${timestamp}-${file.name}`

        const { error: uploadError } = await supabase.storage
          .from('business-plans')
          .upload(filePath, file, { upsert: false })

        if (uploadError) {
          console.error('파일 업로드 실패:', uploadError)
          // 파일 업로드 실패해도 기업은 이미 등록됨 - 나중에 따로 업로드 가능
        } else {
          // DB에 파일 메타데이터 저장
          await supabase.from('business_plans').insert([{
            company_id: company.id,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            file_type: file.name.split('.').pop(),
            notes: notes || '신규 등록 시 업로드',
            uploaded_by: '관리자',
          }])
        }
      }

      resetAll()
      onSuccess()
    } catch (err: any) {
      setFormError(err.message || '저장 중 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const fieldLabels: Record<string, string> = {
    name: '기업명', item_name: '아이템명', representative: '대표자',
    business_number: '사업자번호', business_type: '사업유형', address: '주소',
    open_date: '개업일', region: '지역', category: '분야',
    total_budget: '총 사업비', gov_support: '정부지원금', matching_fund: '대응자금',
    agreement_start: '협약 시작일', agreement_end: '협약 종료일',
    employees_current: '현재 종업원수', employees_planned: '계획 인원',
    revenue_prev: '전년도 매출',
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full my-4">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">새 창업기업 등록</h2>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
          </div>
          {/* 스텝 인디케이터 */}
          <div className="flex items-center gap-2 mt-3">
            {[
              { key: 'upload', label: '1. 사업계획서 업로드' },
              { key: 'analyzing', label: '2. 내용 분석' },
              { key: 'review', label: '3. 확인 및 저장' },
            ].map((s, i) => (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && <div className="w-6 h-px bg-gray-300" />}
                <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                  step === s.key ? 'bg-blue-100 text-blue-700' :
                  (s.key === 'upload' && step !== 'upload') || (s.key === 'analyzing' && step === 'review')
                    ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {(s.key === 'upload' && step !== 'upload') || (s.key === 'analyzing' && step === 'review')
                    ? '✓' : ''} {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Step 1: 파일 업로드 */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                사업계획서를 업로드하면 자동으로 기업 정보를 추출합니다.
                <br />
                <span className="text-gray-500">PDF 또는 DOCX 형식을 권장합니다.</span>
              </p>

              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 hover:bg-blue-50 transition cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                />
                <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-blue-600">클릭하여 사업계획서 선택</span> 또는 드래그
                </p>
                <p className="text-xs text-gray-500 mt-1">PDF, Word, Excel, PowerPoint (최대 50MB)</p>
              </div>

              {file && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <svg className="w-5 h-5 text-blue-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z" clipRule="evenodd" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-gray-400 hover:text-gray-600 ml-2">✕</button>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비고 (선택)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="예: 2026년도 사업계획서" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>

              {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg border border-red-200">{error}</div>}

              <div className="flex gap-2 pt-2">
                <button onClick={handleAnalyze} disabled={!file} className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed">
                  분석 시작
                </button>
                <button onClick={handleClose} className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition">
                  취소
                </button>
              </div>
            </div>
          )}

          {/* Step 2: 분석 중 */}
          {step === 'analyzing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="relative">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600" />
              </div>
              <p className="text-lg font-medium text-gray-900">사업계획서 분석 중...</p>
              <p className="text-sm text-gray-500">파일에서 기업 정보를 추출하고 있습니다</p>
            </div>
          )}

          {/* Step 3: 검토 및 저장 */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* 추출 결과 요약 */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-green-600 text-lg">✓</span>
                  <span className="text-sm font-medium text-green-800">
                    {extractedFields.length > 0
                      ? `${extractedFields.length}개 항목 자동 입력 완료`
                      : '파일 업로드 완료 (자동 추출 항목 없음 - 직접 입력해주세요)'}
                  </span>
                </div>
                {extractedFields.length > 0 && (
                  <p className="text-xs text-green-700 ml-7">
                    자동 입력: {extractedFields.map(f => fieldLabels[f] || f).join(', ')}
                  </p>
                )}
              </div>

              {analysisWarning && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  {analysisWarning}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* 기업명 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      기업명 * {extractedFields.includes('name') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('name') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required />
                  </div>

                  {/* 아이템명 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      아이템명 * {extractedFields.includes('item_name') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="text" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('item_name') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required />
                  </div>

                  {/* 대표자 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      대표자 * {extractedFields.includes('representative') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="text" value={form.representative} onChange={e => setForm({ ...form, representative: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('representative') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required />
                  </div>

                  {/* 사업자번호 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      사업자번호 {extractedFields.includes('business_number') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="text" value={form.business_number} onChange={e => setForm({ ...form, business_number: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('business_number') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} placeholder="000-00-00000" />
                  </div>

                  {/* 주소 */}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      주소 {extractedFields.includes('address') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('address') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} />
                  </div>

                  {/* 지역 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      지역 * {extractedFields.includes('region') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-700 ${extractedFields.includes('region') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required>
                      <option value="">선택</option>
                      {regions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>

                  {/* 분야 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      분야 * {extractedFields.includes('category') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-700 ${extractedFields.includes('category') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required>
                      <option value="">선택</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* 사업유형 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      사업유형 {extractedFields.includes('business_type') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <select value={form.business_type} onChange={e => setForm({ ...form, business_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
                      <option value="개인">개인</option>
                      <option value="법인">법인</option>
                    </select>
                  </div>

                  {/* 개업일 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      개업일 {extractedFields.includes('open_date') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="date" value={form.open_date} onChange={e => setForm({ ...form, open_date: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('open_date') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} />
                  </div>

                  {/* 구분선 - 예산 정보 */}
                  <div className="md:col-span-2 border-t border-gray-200 pt-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">예산 정보</p>
                  </div>

                  {/* 총 사업비 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      총 사업비 * {extractedFields.includes('total_budget') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="number" value={form.total_budget} onChange={e => setForm({ ...form, total_budget: Number(e.target.value) })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('total_budget') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required />
                    {form.total_budget > 0 && <p className="text-xs text-gray-500 mt-0.5">{fmt(form.total_budget)}원</p>}
                  </div>

                  {/* 정부지원금 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      정부지원금 * {extractedFields.includes('gov_support') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="number" value={form.gov_support} onChange={e => setForm({ ...form, gov_support: Number(e.target.value) })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('gov_support') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required />
                    {form.gov_support > 0 && <p className="text-xs text-gray-500 mt-0.5">{fmt(form.gov_support)}원</p>}
                  </div>

                  {/* 대응자금 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      대응자금 * {extractedFields.includes('matching_fund') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="number" value={form.matching_fund} onChange={e => setForm({ ...form, matching_fund: Number(e.target.value) })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('matching_fund') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} required />
                    {form.matching_fund > 0 && <p className="text-xs text-gray-500 mt-0.5">{fmt(form.matching_fund)}원</p>}
                  </div>

                  {/* 대응자금 유형 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">대응자금 유형</label>
                    <select value={form.matching_type} onChange={e => setForm({ ...form, matching_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
                      <option value="현금">현금</option>
                      <option value="현물">현물</option>
                      <option value="혼합">혼합</option>
                    </select>
                  </div>

                  {/* 구분선 - 협약 기간 */}
                  <div className="md:col-span-2 border-t border-gray-200 pt-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">협약 및 기타</p>
                  </div>

                  {/* 협약 시작일 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      협약 시작일 {extractedFields.includes('agreement_start') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="date" value={form.agreement_start} onChange={e => setForm({ ...form, agreement_start: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('agreement_start') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} />
                  </div>

                  {/* 협약 종료일 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      협약 종료일 {extractedFields.includes('agreement_end') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="date" value={form.agreement_end} onChange={e => setForm({ ...form, agreement_end: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('agreement_end') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} />
                  </div>

                  {/* 현재 종업원수 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      현재 종업원수 {extractedFields.includes('employees_current') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="number" value={form.employees_current} onChange={e => setForm({ ...form, employees_current: Number(e.target.value) })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('employees_current') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} />
                  </div>

                  {/* 계획 인원 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      계획 인원 {extractedFields.includes('employees_planned') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="number" value={form.employees_planned} onChange={e => setForm({ ...form, employees_planned: Number(e.target.value) })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('employees_planned') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} />
                  </div>

                  {/* 전년도 매출 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      전년도 매출 {extractedFields.includes('revenue_prev') && <span className="text-blue-500 text-[10px]">자동</span>}
                    </label>
                    <input type="number" value={form.revenue_prev} onChange={e => setForm({ ...form, revenue_prev: Number(e.target.value) })}
                      className={`w-full px-3 py-2 border rounded-lg text-sm text-gray-900 ${extractedFields.includes('revenue_prev') ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'}`} />
                    {form.revenue_prev > 0 && <p className="text-xs text-gray-500 mt-0.5">{fmt(form.revenue_prev)}원</p>}
                  </div>
                </div>

                {/* 오류 */}
                {formError && <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg border border-red-200 whitespace-pre-wrap">{formError}</div>}

                {/* 버튼 */}
                <div className="flex flex-col gap-2 pt-3 border-t border-gray-200">
                  {/* 주요 버튼 */}
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving}
                      className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">
                      {saving ? '저장 중...' : '저장'}
                    </button>
                    <button type="button" onClick={() => { setStep('upload'); setForm({ ...defaultForm }); setExtractedFields([]); setAnalysisWarning('') }}
                      className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition">
                      다시 업로드
                    </button>
                    <button type="button" onClick={handleClose}
                      className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition">
                      취소
                    </button>
                  </div>
                  {/* 추출 결과 저장 버튼 */}
                  <button type="button" onClick={handleSaveExtraction}
                    className="w-full px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    추출 결과를 파일로 저장 (JSON, Markdown, CSV)
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
