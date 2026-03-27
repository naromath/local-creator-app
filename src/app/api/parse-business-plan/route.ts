import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI, type Part } from '@google/generative-ai'

export const runtime = 'nodejs'
export const maxDuration = 120

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')
const DEFAULT_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
const GEMINI_MODELS = (process.env.GEMINI_MODEL || '')
  .split(',')
  .map(model => model.trim())
  .filter(Boolean)

async function generateJsonWithGemini(parts: Part[]): Promise<string> {
  const modelCandidates = GEMINI_MODELS.length > 0 ? GEMINI_MODELS : DEFAULT_GEMINI_MODELS
  let lastError: any

  for (const modelName of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' },
      })
      const result = await model.generateContent(parts)
      return result.response.text().trim()
    } catch (err: any) {
      lastError = err
      const message = String(err?.message || '')
      const unavailableModel =
        message.includes('no longer available') ||
        message.includes('404 Not Found') ||
        message.includes('model not found')

      if (!unavailableModel) {
        throw err
      }
    }
  }

  throw lastError || new Error('Gemini 모델 호출에 실패했습니다')
}

// Gemini로 PDF/DOCX에서 기업 정보를 구조화된 JSON으로 직접 추출
async function extractWithGemini(
  buffer: Buffer,
  mimeType: string
): Promise<{ data: Record<string, any>; rawText: string; error?: string }> {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return { data: {}, rawText: '', error: 'GOOGLE_GEMINI_API_KEY가 설정되지 않았습니다' }
  }

  const base64Data = buffer.toString('base64')

  const prompt = `다음 사업계획서 문서를 분석하여 아래 항목들을 추출해주세요.
반드시 JSON 형식으로만 응답하세요. 다른 설명 없이 순수 JSON만 반환하세요.
찾을 수 없는 항목은 null로 표시하세요.

추출할 항목:
{
  "name": "기업명 또는 상호명",
  "item_name": "사업 아이템명 또는 사업명",
  "representative": "대표자 이름",
  "business_number": "사업자등록번호 (000-00-00000 형식)",
  "business_type": "개인 또는 법인",
  "address": "사업장 주소 또는 소재지",
  "open_date": "개업일 또는 창업일 (YYYY-MM-DD 형식)",
  "region": "지역 (서울/부산/대구/인천/광주/대전/전남 중 하나)",
  "category": "사업 분야 (지역가치/로컬푸드/지역기반제조/지역특화관광/거점브랜드/디지털문화체험/자연친화활동 중 하나)",
  "total_budget": "총 사업비 (숫자만, 원 단위. 예: 50000000)",
  "gov_support": "정부지원금 또는 국비 (숫자만, 원 단위)",
  "matching_fund": "대응자금 또는 자부담 (숫자만, 원 단위)",
  "matching_type": "대응자금 유형 (현금/현물/혼합 중 하나)",
  "agreement_start": "협약 시작일 (YYYY-MM-DD 형식)",
  "agreement_end": "협약 종료일 (YYYY-MM-DD 형식)",
  "employees_current": "현재 종업원 수 (숫자만)",
  "employees_planned": "계획 고용 인원 (숫자만)",
  "revenue_prev": "전년도 매출액 (숫자만, 원 단위)",
  "budget_items": [
    {
      "category": "비목 대분류 (인건비/재료비/외주용역비/기계장치/시설비/마케팅홍보비/지식재산권/간접비/기타 중 하나)",
      "subcategory": "세부 항목명 (예: 대표자인건비, 원재료구입비, 홈페이지제작비 등)",
      "description": "항목 설명 또는 용도 (없으면 빈 문자열)",
      "planned_amount": "계획 금액 (숫자만, 원 단위)"
    }
  ]
}`

  try {
    const responseText = await generateJsonWithGemini([
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType as any,
        },
      },
      { text: prompt },
    ])

    // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
      responseText.match(/```\s*([\s\S]*?)\s*```/) ||
      responseText.match(/(\{[\s\S]*\})/)

    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText

    let parsed: Record<string, any> = {}
    try {
      parsed = JSON.parse(jsonStr.trim())
    } catch {
      // JSON 파싱 실패 시 빈 객체 반환
      return { data: {}, rawText: responseText, error: 'JSON 파싱 실패' }
    }

    // null/빈값 필터링 및 타입 정규화
    const cleaned: Record<string, any> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined || value === '') continue

      // 배열 필드 (budget_items) — 그대로 보존
      if (key === 'budget_items') {
        if (Array.isArray(value) && value.length > 0) cleaned[key] = value
        continue
      }

      // 숫자 필드 처리
      if (['total_budget', 'gov_support', 'matching_fund', 'revenue_prev',
        'employees_current', 'employees_planned'].includes(key)) {
        const num = typeof value === 'number' ? value : parseInt(String(value).replace(/[^0-9]/g, ''))
        if (!isNaN(num) && num > 0) cleaned[key] = num
      }
      // 날짜 필드 처리 (YYYY-MM-DD 형식 강제)
      else if (['open_date', 'agreement_start', 'agreement_end'].includes(key)) {
        const dateStr = String(value)
        const dateMatch = dateStr.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
        if (dateMatch) {
          cleaned[key] = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
        }
      }
      // 문자열 필드
      else {
        cleaned[key] = String(value).trim()
      }
    }

    return { data: cleaned, rawText: responseText }
  } catch (err: any) {
    return { data: {}, rawText: '', error: err.message }
  }
}

// DOCX 텍스트 추출 + Gemini 분석
async function extractFromDocx(buffer: Buffer): Promise<{ data: Record<string, any>; rawText: string; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    const text = result.value || ''

    if (!text.trim()) {
      return { data: {}, rawText: '', error: '텍스트 추출 실패' }
    }

    // 추출된 텍스트를 Gemini로 분석
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { data: {}, rawText: text, error: 'API 키 없음' }
    }

    const prompt = `다음은 사업계획서에서 추출한 텍스트입니다. 아래 항목들을 추출하여 JSON으로만 응답하세요.
찾을 수 없는 항목은 null로 표시하세요.

텍스트:
${text.substring(0, 8000)}

추출 항목:
{
  "name": "기업명",
  "item_name": "사업 아이템명",
  "representative": "대표자 이름",
  "business_number": "사업자등록번호 (000-00-00000 형식)",
  "business_type": "개인 또는 법인",
  "address": "사업장 주소",
  "open_date": "개업일 (YYYY-MM-DD)",
  "region": "지역 (서울/부산/대구/인천/광주/대전/전남 중 하나)",
  "category": "분야 (지역가치/로컬푸드/지역기반제조/지역특화관광/거점브랜드/디지털문화체험/자연친화활동 중 하나)",
  "total_budget": "총 사업비 (숫자, 원 단위)",
  "gov_support": "정부지원금 (숫자, 원 단위)",
  "matching_fund": "대응자금 (숫자, 원 단위)",
  "matching_type": "현금/현물/혼합",
  "agreement_start": "협약 시작일 (YYYY-MM-DD)",
  "agreement_end": "협약 종료일 (YYYY-MM-DD)",
  "employees_current": "현재 종업원 수 (숫자)",
  "employees_planned": "계획 인원 (숫자)",
  "revenue_prev": "전년도 매출 (숫자, 원 단위)",
  "budget_items": [
    {
      "category": "비목 대분류 (인건비/재료비/외주용역비/기계장치/시설비/마케팅홍보비/지식재산권/간접비/기타 중 하나)",
      "subcategory": "세부 항목명",
      "description": "항목 설명 (없으면 빈 문자열)",
      "planned_amount": "계획 금액 (숫자, 원 단위)"
    }
  ]
}`

    const responseText = await generateJsonWithGemini([{ text: prompt }])

    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
      responseText.match(/```\s*([\s\S]*?)\s*```/) ||
      responseText.match(/(\{[\s\S]*\})/)

    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText

    let parsed: Record<string, any> = {}
    try {
      parsed = JSON.parse(jsonStr.trim())
    } catch {
      return { data: {}, rawText: text }
    }

    const cleaned: Record<string, any> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined || value === '') continue
      if (key === 'budget_items') {
        if (Array.isArray(value) && value.length > 0) cleaned[key] = value
        continue
      }
      if (['total_budget', 'gov_support', 'matching_fund', 'revenue_prev',
        'employees_current', 'employees_planned'].includes(key)) {
        const num = typeof value === 'number' ? value : parseInt(String(value).replace(/[^0-9]/g, ''))
        if (!isNaN(num) && num > 0) cleaned[key] = num
      } else if (['open_date', 'agreement_start', 'agreement_end'].includes(key)) {
        const dateStr = String(value)
        const dateMatch = dateStr.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
        if (dateMatch) {
          cleaned[key] = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
        }
      } else {
        cleaned[key] = String(value).trim()
      }
    }

    return { data: cleaned, rawText: text }
  } catch (err: any) {
    return { data: {}, rawText: '', error: err.message }
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = file.name.toLowerCase()

    let extractedData: Record<string, any> = {}
    let rawTextPreview = ''
    let warning: string | undefined

    // PDF → Gemini 직접 분석
    if (fileName.endsWith('.pdf')) {
      const result = await extractWithGemini(buffer, 'application/pdf')
      extractedData = result.data
      rawTextPreview = result.rawText.substring(0, 300)
      if (result.error) {
        warning = `PDF 분석 중 오류: ${result.error}. 추출된 항목만 표시됩니다.`
      }
    }
    // DOCX → 텍스트 추출 후 Gemini 분석
    else if (fileName.endsWith('.docx')) {
      const result = await extractFromDocx(buffer)
      extractedData = result.data
      rawTextPreview = result.rawText.substring(0, 300)
      if (result.error) {
        warning = `Word 파일 분석 중 오류: ${result.error}.`
      }
    }
    // 기타 지원 형식
    else if (['.doc', '.xls', '.xlsx', '.ppt', '.pptx'].some(ext => fileName.endsWith(ext))) {
      warning = `${fileName.split('.').pop()?.toUpperCase()} 형식은 PDF 또는 DOCX보다 추출 정확도가 낮습니다. 항목을 직접 확인해주세요.`
    }
    else {
      return NextResponse.json({ error: '지원하지 않는 파일 형식입니다' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      extractedData,
      rawTextPreview,
      rawTextLength: rawTextPreview.length,
      ...(warning ? { warning } : {}),
    })

  } catch (err: any) {
    console.error('Parse API 오류:', err.message)
    return NextResponse.json({
      success: true,
      extractedData: {},
      rawTextPreview: '',
      warning: `처리 중 오류가 발생했습니다. 항목을 직접 입력해주세요. (${err.message})`,
    })
  }
}
