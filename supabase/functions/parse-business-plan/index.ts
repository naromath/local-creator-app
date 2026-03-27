const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
const GEMINI_MODELS = (Deno.env.get('GEMINI_MODEL') || '')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean)

const EXTRACTION_PROMPT = `다음 사업계획서 문서를 분석하여 아래 항목들을 추출해주세요.
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
  "revenue_prev": "전년도 매출액 (숫자만, 원 단위)"
}`

type GeminiApiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
  error?: {
    message?: string
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function extractJsonString(responseText: string): string {
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
    responseText.match(/```\s*([\s\S]*?)\s*```/) ||
    responseText.match(/(\{[\s\S]*\})/)

  return (jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText).trim()
}

function normalizeExtractedData(parsed: Record<string, unknown>): Record<string, string | number> {
  const normalized: Record<string, string | number> = {}

  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined || value === '') continue

    if (['total_budget', 'gov_support', 'matching_fund', 'revenue_prev',
      'employees_current', 'employees_planned'].includes(key)) {
      const num = typeof value === 'number' ? value : parseInt(String(value).replace(/[^0-9]/g, ''), 10)
      if (!Number.isNaN(num) && num > 0) normalized[key] = num
      continue
    }

    if (['open_date', 'agreement_start', 'agreement_end'].includes(key)) {
      const dateStr = String(value)
      const dateMatch = dateStr.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
      if (dateMatch) {
        normalized[key] = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
      }
      continue
    }

    normalized[key] = String(value).trim()
  }

  return normalized
}

async function callGeminiModel(
  apiKey: string,
  modelName: string,
  parts: Array<Record<string, unknown>>
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: { responseMimeType: 'application/json' },
      contents: [{ parts }],
    }),
  })

  const payload = await response.json().catch(() => ({})) as GeminiApiResponse

  if (!response.ok) {
    throw new Error(payload.error?.message || `${response.status} ${response.statusText}`)
  }

  const responseText = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('\n')
    .trim()

  if (!responseText) {
    throw new Error('Gemini 응답 텍스트가 비어 있습니다')
  }

  return responseText
}

async function generateJsonWithGemini(
  apiKey: string,
  parts: Array<Record<string, unknown>>
): Promise<string> {
  const modelCandidates = GEMINI_MODELS.length > 0 ? GEMINI_MODELS : DEFAULT_GEMINI_MODELS
  let lastError: Error | null = null

  for (const modelName of modelCandidates) {
    try {
      return await callGeminiModel(apiKey, modelName, parts)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      lastError = error
      const message = error.message || ''
      const unavailableModel =
        message.includes('no longer available') ||
        message.includes('404 Not Found') ||
        message.includes('model not found')

      if (!unavailableModel) {
        throw error
      }
    }
  }

  throw lastError || new Error('Gemini 모델 호출에 실패했습니다')
}

function inferMimeType(fileName: string, providedType: string): string {
  if (providedType) return providedType
  if (fileName.endsWith('.pdf')) return 'application/pdf'
  if (fileName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

async function extractStructuredData(file: File, apiKey: string): Promise<{ data: Record<string, string | number>; rawText: string; error?: string }> {
  try {
    const fileName = file.name.toLowerCase()
    const mimeType = inferMimeType(fileName, file.type || '')
    const arrayBuffer = await file.arrayBuffer()
    const base64Data = bytesToBase64(new Uint8Array(arrayBuffer))

    const responseText = await generateJsonWithGemini(apiKey, [
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      { text: EXTRACTION_PROMPT },
    ])

    const parsed = JSON.parse(extractJsonString(responseText)) as Record<string, unknown>
    return { data: normalizeExtractedData(parsed), rawText: responseText }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return { data: {}, rawText: '', error: error.message }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST 메서드만 지원합니다' }, 405)
  }

  try {
    const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY')?.trim()
    if (!apiKey) {
      return jsonResponse({
        success: true,
        extractedData: {},
        rawTextPreview: '',
        warning: 'Supabase Secret에 GOOGLE_GEMINI_API_KEY가 설정되지 않았습니다.',
      })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return jsonResponse({ error: '파일이 없습니다' }, 400)
    }

    const fileName = file.name.toLowerCase()
    let extractedData: Record<string, string | number> = {}
    let rawTextPreview = ''
    let warning: string | undefined

    if (fileName.endsWith('.pdf') || fileName.endsWith('.docx')) {
      const result = await extractStructuredData(file, apiKey)
      extractedData = result.data
      rawTextPreview = result.rawText.substring(0, 300)
      if (result.error) {
        const label = fileName.endsWith('.pdf') ? 'PDF' : 'Word'
        warning = `${label} 분석 중 오류: ${result.error}. 추출된 항목만 표시됩니다.`
      }
    } else if (['.doc', '.xls', '.xlsx', '.ppt', '.pptx'].some((ext) => fileName.endsWith(ext))) {
      warning = `${fileName.split('.').pop()?.toUpperCase()} 형식은 PDF 또는 DOCX보다 추출 정확도가 낮습니다. 항목을 직접 확인해주세요.`
    } else {
      return jsonResponse({ error: '지원하지 않는 파일 형식입니다' }, 400)
    }

    return jsonResponse({
      success: true,
      extractedData,
      rawTextPreview,
      rawTextLength: rawTextPreview.length,
      ...(warning ? { warning } : {}),
    })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return jsonResponse({
      success: true,
      extractedData: {},
      rawTextPreview: '',
      warning: `처리 중 오류가 발생했습니다. 항목을 직접 입력해주세요. (${error.message})`,
    })
  }
})
