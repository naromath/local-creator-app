'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface FileUploadModalProps {
  companyId: number
  companyName: string
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function FileUploadModal({
  companyId,
  companyName,
  isOpen,
  onClose,
  onSuccess,
}: FileUploadModalProps) {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    // 파일 크기 확인 (최대 50MB)
    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('파일 크기는 50MB 이하여야 합니다')
      return
    }

    // 파일 타입 확인 (PDF, Word, Excel, PowerPoint)
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]

    if (!allowedTypes.includes(selectedFile.type)) {
      setError('PDF, Word, Excel, PowerPoint 파일만 업로드 가능합니다')
      return
    }

    setFile(selectedFile)
    setError('')
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      setError('파일을 선택해주세요')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Supabase Storage에 파일 업로드
      const fileExtension = file.name.split('.').pop()
      const timestamp = Date.now()
      const filePath = `business-plans/${companyId}/${timestamp}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('business-plans')
        .upload(filePath, file, { upsert: false })

      if (uploadError) throw uploadError

      // DB에 파일 정보 저장
      const { error: dbError } = await supabase.from('business_plans').insert([
        {
          company_id: companyId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: fileExtension,
          notes: notes || null,
          uploaded_by: '관리자',
        },
      ])

      if (dbError) throw dbError

      // 성공
      setFile(null)
      setNotes('')
      setUploadProgress(0)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      onSuccess()
    } catch (err: any) {
      setError(err.message || '파일 업로드 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">사업계획서 업로드</h2>
        <p className="text-sm text-gray-500 mb-5">{companyName}</p>

        <form onSubmit={handleUpload} className="space-y-4">
          {/* 파일 선택 */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition cursor-pointer"
            onClick={() => fileInputRef.current?.click()}>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              disabled={loading}
            />
            <svg className="w-10 h-10 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-blue-600">클릭하여 파일 선택</span> 또는 드래그
            </p>
            <p className="text-xs text-gray-500 mt-1">PDF, Word, Excel, PowerPoint (최대 50MB)</p>
          </div>

          {/* 선택된 파일 */}
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
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                className="text-gray-400 hover:text-gray-600 ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* 비고 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">비고 (선택사항)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="예: 2025년도 사업계획서, 최종 수정본"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none text-gray-900"
              disabled={loading}
            />
          </div>

          {/* 오류 메시지 */}
          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          {/* 업로드 진행률 */}
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>업로드 중...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {/* 버튼 */}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={!file || loading}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '업로드 중...' : '업로드'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
