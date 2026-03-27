'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import FileUploadModal from '@/components/FileUploadModal'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const statusColors: Record<string, string> = {
  '진행중': 'bg-blue-100 text-blue-800',
  '보완필요': 'bg-yellow-100 text-yellow-800',
  '중단': 'bg-red-100 text-red-800',
  '완료': 'bg-green-100 text-green-800',
  '검토중': 'bg-orange-100 text-orange-800',
  '승인': 'bg-green-100 text-green-800',
  '반려': 'bg-red-100 text-red-800',
}
function fmt(n: number) { return new Intl.NumberFormat('ko-KR').format(n) }

export default function CompanyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const [company, setCompany] = useState<any>(null)
  const [budgetItems, setBudgetItems] = useState<any[]>([])
  const [inspections, setInspections] = useState<any[]>([])
  const [changeRequests, setChangeRequests] = useState<any[]>([])
  const [purchaseApprovals, setPurchaseApprovals] = useState<any[]>([])
  const [inKind, setInKind] = useState<any[]>([])
  const [businessPlans, setBusinessPlans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('budget')
  const [showFileUpload, setShowFileUpload] = useState(false)

  // Budget form
  const [showBudgetForm, setShowBudgetForm] = useState(false)
  const [budgetForm, setBudgetForm] = useState({ category: '', subcategory: '', description: '', planned_amount: 0, executed_amount: 0 })

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Inspection form
  const [showInspForm, setShowInspForm] = useState(false)
  const [inspForm, setInspForm] = useState({ type: '수시', grade: '계속', notes: '', inspector: '담당자', inspected_at: new Date().toISOString().slice(0, 10) })

  async function load() {
    const id = Number(params.id)
    const [c, b, i, cr, pa, ik, bp] = await Promise.all([
      supabase.from('companies').select('*').eq('id', id).single(),
      supabase.from('budget_items').select('*').eq('company_id', id).order('category'),
      supabase.from('inspections').select('*').eq('company_id', id).order('inspected_at', { ascending: false }),
      supabase.from('change_requests').select('*').eq('company_id', id).order('created_at', { ascending: false }),
      supabase.from('purchase_approvals').select('*').eq('company_id', id).order('created_at', { ascending: false }),
      supabase.from('inkind_contributions').select('*').eq('company_id', id),
      supabase.from('business_plans').select('*').eq('company_id', id).order('uploaded_at', { ascending: false }),
    ])
    setCompany(c.data)
    setBudgetItems(b.data || [])
    setInspections(i.data || [])
    setChangeRequests(cr.data || [])
    setPurchaseApprovals(pa.data || [])
    setInKind(ik.data || [])
    setBusinessPlans(bp.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [params.id])

  const totalPlanned = budgetItems.reduce((s, b) => s + (b.planned_amount || 0), 0)
  const totalExecuted = budgetItems.reduce((s, b) => s + (b.executed_amount || 0), 0)
  const execRate = totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0

  const addBudgetItem = async (e: React.FormEvent) => {
    e.preventDefault()
    await supabase.from('budget_items').insert([{ ...budgetForm, company_id: Number(params.id) }])
    setShowBudgetForm(false)
    setBudgetForm({ category: '', subcategory: '', description: '', planned_amount: 0, executed_amount: 0 })
    load()
  }

  const updateExecution = async (itemId: number, amount: number) => {
    await supabase.from('budget_items').update({ executed_amount: amount }).eq('id', itemId)
    load()
  }

  const addInspection = async (e: React.FormEvent) => {
    e.preventDefault()
    await supabase.from('inspections').insert([{ ...inspForm, company_id: Number(params.id) }])
    // Update company status based on grade
    if (inspForm.grade === '중단' || inspForm.grade === '부적정') {
      await supabase.from('companies').update({ status: '중단' }).eq('id', Number(params.id))
    } else if (inspForm.grade === '보완') {
      await supabase.from('companies').update({ status: '보완필요' }).eq('id', Number(params.id))
    } else if (inspForm.grade === '적정') {
      await supabase.from('companies').update({ status: '완료' }).eq('id', Number(params.id))
    }
    setShowInspForm(false)
    setInspForm({ type: '수시', grade: '계속', notes: '', inspector: '담당자', inspected_at: new Date().toISOString().slice(0, 10) })
    load()
  }

  const handleDelete = async () => {
    setDeleting(true)
    const id = Number(params.id)

    // FK 의존 순서: evidences → budget_changes → budget_items
    //               budget_changes → change_requests
    // 그 다음 나머지 → companies 순으로 삭제

    // budget_items 의 자식 테이블 먼저
    const budgetItemIds = budgetItems.map(b => b.id)
    if (budgetItemIds.length > 0) {
      await supabase.from('evidences').delete().in('budget_item_id', budgetItemIds)
      await supabase.from('budget_changes').delete().in('budget_item_id', budgetItemIds)
    }
    // change_requests 의 자식
    const crIds = changeRequests.map(c => c.id)
    if (crIds.length > 0) {
      await supabase.from('budget_changes').delete().in('change_request_id', crIds)
    }

    const steps = [
      supabase.from('budget_items').delete().eq('company_id', id),
      supabase.from('inspections').delete().eq('company_id', id),
      supabase.from('change_requests').delete().eq('company_id', id),
      supabase.from('purchase_approvals').delete().eq('company_id', id),
      supabase.from('inkind_contributions').delete().eq('company_id', id),
      supabase.from('business_plans').delete().eq('company_id', id),
    ]
    for (const step of steps) { await step }

    const { error } = await supabase.from('companies').delete().eq('id', id)
    if (error) {
      alert(`삭제 실패: ${error.message}`)
      setDeleting(false)
      setShowDeleteConfirm(false)
      return
    }
    router.push('/companies')
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  if (!company) return <div className="text-center py-16 text-gray-400">기업을 찾을 수 없습니다</div>

  const tabs = [
    { key: 'budget', label: '예산 집행' },
    { key: 'businessplan', label: `사업계획서 (${businessPlans.length})` },
    { key: 'inspections', label: `점검 (${inspections.length})` },
    { key: 'changes', label: `변경신청 (${changeRequests.length})` },
    { key: 'purchases', label: `구매승인 (${purchaseApprovals.length})` },
    { key: 'inkind', label: '현물 대응자금' },
  ]

  return (
    <>
      <FileUploadModal
        isOpen={showFileUpload}
        onClose={() => setShowFileUpload(false)}
        companyId={Number(params.id)}
        companyName={company?.name || ''}
        onSuccess={() => {
          setShowFileUpload(false)
          load()
        }}
      />
    <div className="space-y-4">
      <Link href="/companies" className="text-sm text-blue-600 hover:underline">&larr; 기업 목록</Link>

      {/* Company header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">{company.name}</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[company.status]}`}>{company.status}</span>
            </div>
            <p className="text-gray-600 mt-1">{company.item_name}</p>
          </div>
          <div className="text-right text-sm text-gray-600 space-y-1">
            <p>대표: {company.representative} | {company.business_type}</p>
            <p>{company.region} · {company.category}</p>
            <p>협약: {company.agreement_start} ~ {company.agreement_end}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100">
          <div><p className="text-xs text-gray-500">총 사업비</p><p className="text-lg font-bold text-gray-900">{fmt(company.total_budget)}원</p></div>
          <div><p className="text-xs text-gray-500">정부지원금</p><p className="text-lg font-bold text-blue-600">{fmt(company.gov_support)}원</p></div>
          <div><p className="text-xs text-gray-500">대응자금 ({company.matching_type})</p><p className="text-lg font-bold text-gray-900">{fmt(company.matching_fund)}원</p></div>
          <div>
            <p className="text-xs text-gray-500">예산 집행률</p>
            <p className="text-lg font-bold text-gray-900">{execRate}%</p>
            <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${execRate}%` }} /></div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white rounded-t-xl">
        <div className="flex gap-0 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-b-xl rounded-xl border border-gray-200 p-5">
        {tab === 'budget' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-gray-900">비목별 예산 항목</h3>
              <button onClick={() => setShowBudgetForm(!showBudgetForm)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+ 항목 추가</button>
            </div>
            {showBudgetForm && (
              <form onSubmit={addBudgetItem} className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-gray-50 rounded-lg">
                <input placeholder="비목" value={budgetForm.category} onChange={e => setBudgetForm({ ...budgetForm, category: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" required />
                <input placeholder="세목" value={budgetForm.subcategory} onChange={e => setBudgetForm({ ...budgetForm, subcategory: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" required />
                <input placeholder="설명" value={budgetForm.description} onChange={e => setBudgetForm({ ...budgetForm, description: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" />
                <input type="number" placeholder="계획 금액" value={budgetForm.planned_amount} onChange={e => setBudgetForm({ ...budgetForm, planned_amount: Number(e.target.value) })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" required />
                <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">추가</button>
              </form>
            )}
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">비목</th>
                  <th className="text-left px-4 py-2 font-medium">세목</th>
                  <th className="text-left px-4 py-2 font-medium">내용</th>
                  <th className="text-right px-4 py-2 font-medium">계획</th>
                  <th className="text-right px-4 py-2 font-medium">집행</th>
                  <th className="text-right px-4 py-2 font-medium">집행률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {budgetItems.map(b => {
                  const rate = b.planned_amount > 0 ? Math.round((b.executed_amount / b.planned_amount) * 100) : 0
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{b.category}</td>
                      <td className="px-4 py-2 text-gray-700">{b.subcategory}</td>
                      <td className="px-4 py-2 text-gray-700">{b.description}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{fmt(b.planned_amount)}</td>
                      <td className="px-4 py-2 text-right">
                        <input type="number" value={b.executed_amount} onChange={e => updateExecution(b.id, Number(e.target.value))}
                          className="w-28 text-right px-2 py-1 border border-gray-200 rounded text-sm text-gray-900" />
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{rate}%</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-gray-900">합계</td>
                  <td className="px-4 py-2 text-right text-gray-900">{fmt(totalPlanned)}</td>
                  <td className="px-4 py-2 text-right text-gray-900">{fmt(totalExecuted)}</td>
                  <td className="px-4 py-2 text-right text-gray-900">{execRate}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {tab === 'inspections' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-gray-900">점검 기록</h3>
              <button onClick={() => setShowInspForm(!showInspForm)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+ 점검 등록</button>
            </div>
            {showInspForm && (
              <form onSubmit={addInspection} className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-gray-50 rounded-lg">
                <select value={inspForm.type} onChange={e => setInspForm({ ...inspForm, type: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
                  <option value="수시">수시</option><option value="중간">중간</option><option value="최종">최종</option>
                </select>
                <select value={inspForm.grade} onChange={e => setInspForm({ ...inspForm, grade: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700">
                  <option value="계속">계속</option><option value="보완">보완</option><option value="적정">적정</option><option value="중단">중단</option><option value="부적정">부적정</option>
                </select>
                <input placeholder="비고" value={inspForm.notes} onChange={e => setInspForm({ ...inspForm, notes: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" />
                <input type="date" value={inspForm.inspected_at} onChange={e => setInspForm({ ...inspForm, inspected_at: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900" />
                <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">등록</button>
              </form>
            )}
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">유형</th>
                  <th className="text-left px-4 py-2 font-medium">등급</th>
                  <th className="text-left px-4 py-2 font-medium">비고</th>
                  <th className="text-left px-4 py-2 font-medium">점검자</th>
                  <th className="text-left px-4 py-2 font-medium">날짜</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inspections.map(i => (
                  <tr key={i.id}><td className="px-4 py-2 text-gray-900">{i.type}</td><td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${i.grade === '계속' || i.grade === '적정' ? 'bg-green-100 text-green-800' : i.grade === '보완' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{i.grade}</span></td><td className="px-4 py-2 text-gray-700">{i.notes}</td><td className="px-4 py-2 text-gray-700">{i.inspector}</td><td className="px-4 py-2 text-gray-700">{i.inspected_at?.slice(0, 10)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'changes' && (
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">변경 신청 내역</h3>
            {changeRequests.length === 0 ? <p className="text-gray-400 text-sm py-4">변경 신청 내역이 없습니다</p> :
              changeRequests.map(cr => (
                <div key={cr.id} className="border border-gray-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{cr.type}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[cr.status]}`}>{cr.status}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><p className="text-gray-500">변경 전</p><p className="text-gray-700">{cr.before_content}</p></div>
                    <div><p className="text-gray-500">변경 후</p><p className="text-gray-700">{cr.after_content}</p></div>
                  </div>
                  <p className="text-sm text-gray-600">사유: {cr.reason}</p>
                  {cr.reviewer_note && <p className="text-sm text-gray-600">검토 의견: {cr.reviewer_note}</p>}
                </div>
              ))
            }
          </div>
        )}

        {tab === 'purchases' && (
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">구매 승인 내역</h3>
            {purchaseApprovals.length === 0 ? <p className="text-gray-400 text-sm py-4">구매 승인 내역이 없습니다</p> :
              purchaseApprovals.map(pa => (
                <div key={pa.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{pa.item_name}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColors[pa.status]}`}>{pa.status}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">금액: {fmt(pa.amount)}원 | 목적: {pa.purpose}</p>
                  <p className="text-sm text-gray-500">견적서: {pa.quote_count}건 | 첨부: {pa.quote_attached ? '예' : '아니오'}</p>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'businessplan' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-gray-900">사업계획서</h3>
              <button onClick={() => setShowFileUpload(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                + 파일 업로드
              </button>
            </div>
            {businessPlans.length === 0 ? (
              <p className="text-gray-400 text-sm py-8 text-center">업로드된 사업계획서가 없습니다</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">파일명</th>
                    <th className="text-right px-4 py-2 font-medium">크기</th>
                    <th className="text-left px-4 py-2 font-medium">형식</th>
                    <th className="text-left px-4 py-2 font-medium">업로드자</th>
                    <th className="text-left px-4 py-2 font-medium">날짜</th>
                    <th className="text-left px-4 py-2 font-medium">비고</th>
                    <th className="text-center px-4 py-2 font-medium">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {businessPlans.map(bp => (
                    <tr key={bp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{bp.file_name}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{(bp.file_size / 1024 / 1024).toFixed(2)} MB</td>
                      <td className="px-4 py-2 text-gray-600">{bp.file_type?.toUpperCase() || '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{bp.uploaded_by}</td>
                      <td className="px-4 py-2 text-gray-600">{bp.uploaded_at?.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-gray-600">{bp.notes || '-'}</td>
                      <td className="px-4 py-2 text-center space-x-1">
                        <a href={`https://ztwvlcnsqfmogmekrtki.supabase.co/storage/v1/object/public/business-plans/${bp.file_path}`} target="_blank" rel="noopener noreferrer" className="inline-block px-2 py-1 text-blue-600 hover:text-blue-700 font-medium text-xs">
                          다운로드
                        </a>
                        <button onClick={async () => {
                          if (confirm('이 파일을 삭제하시겠습니까?')) {
                            await supabase.from('business_plans').delete().eq('id', bp.id)
                            load()
                          }
                        }} className="inline-block px-2 py-1 text-red-600 hover:text-red-700 font-medium text-xs">
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'inkind' && (
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">현물 대응자금</h3>
            {inKind.length === 0 ? <p className="text-gray-400 text-sm py-4">현물 대응자금 내역이 없습니다</p> :
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">기여자</th>
                    <th className="text-left px-4 py-2 font-medium">역할</th>
                    <th className="text-right px-4 py-2 font-medium">금액</th>
                    <th className="text-left px-4 py-2 font-medium">기간</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {inKind.map(ik => (
                    <tr key={ik.id}><td className="px-4 py-2 text-gray-900">{ik.contributor_name}</td><td className="px-4 py-2 text-gray-700">{ik.role}</td><td className="px-4 py-2 text-right text-gray-700">{fmt(ik.amount)}원</td><td className="px-4 py-2 text-gray-700">{ik.period}</td></tr>
                  ))}
                </tbody>
              </table>
            }
          </div>
        )}
      </div>
      {/* 하단 위험 구역 */}
      <div className="border border-red-200 rounded-xl p-4 bg-red-50">
        <p className="text-sm font-medium text-red-700 mb-1">위험 구역</p>
        <p className="text-xs text-red-500 mb-3">기업을 삭제하면 예산, 점검, 변경신청, 구매승인, 사업계획서 등 모든 관련 데이터가 영구적으로 삭제됩니다.</p>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition">
          이 기업 삭제
        </button>
      </div>
    </div>

    {/* 삭제 확인 모달 */}
    {showDeleteConfirm && (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">기업 삭제 확인</h3>
              <p className="text-sm text-gray-600 mt-1">
                <span className="font-semibold text-gray-800">{company?.name}</span> 기업과 관련된 모든 데이터(예산 {budgetItems.length}건, 점검 {inspections.length}건 등)가 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition disabled:opacity-50">
              취소
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
              {deleting ? '삭제 중...' : '삭제 확인'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
