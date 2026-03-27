import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// 숫자 추출 유틸 (콤마, 원, 만원 등 처리)
function extractNumber(text: string): number {
  const manMatch = text.match(/([\d,]+)\s*만\s*원?/)
  if (manMatch) {
    return parseInt(manMatch[1].replace(/,/g, '')) * 10000
  }
  const numMatch = text.match(/([\d,]+)\s*원?/)
  if (numMatch) {
    return parseInt(numMatch[1].replace(/,/g, ''))
  }
  return 0
}

// 한국 지역 매칭
function matchRegion(text: string): string {
  const regions: Record<string, string[]> = {
    '서울': ['서울'], '부산': ['부산'], '대구': ['대구'],
    '인천': ['인천'], '광주': ['광주'], '대전': ['대전'],
  }
  for (const [region, keywords] of Object.entries(regions)) {
    if (keywords.some(kw => text.includes(kw))) return region
  }
  return ''
}

// 분야 매칭
function matchCategory(text: string): string {
  const categories: Record<string, string[]> = {
    '지역가치': ['지역가치', '지역 가치', '커뮤니티'],
    '로컬푸드': ['로컬푸드', '로컬 푸드', '지역 먹거리', '농산물', '식품', '음식'],
    '지역기반제조': ['제조', '생산', '공방', '수공예', '핸드메이드'],
    '지역특화관광': ['관광', '여행', '투어', '체험관광', '숙박'],
    '거점브랜드': ['브랜드', '거점', '로컬브랜드'],
    '디지털문화체험': ['디지털', '문화', '체험', 'IT', '콘텐츠', '미디어'],
    '자연친화활동': ['자연', '친환경', '에코', '환경', '농촌'],
  }
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(kw => text.includes(kw))) return cat
  }
  return ''
}

// 텍스트에서 구조화된 기업 정보 추출
function extractCompanyInfo(text: string) {
  const result: Record<string, any> = {}

  const namePatterns = [
    /(?:기업명|상\s*호|업체명|회사명|법인명)\s*[:\-\s]*([^\n,)(]{2,30})/,
  ]
  for (const p of namePatterns) {
    const m = text.match(p)
    if (m) { result.name = m[1].trim(); break }
  }

  const repPatterns = [
    /(?:대표자|대표이사|대\s*표)\s*[:\-\s]*([^\n,)(]{2,15})/,
  ]
  for (const p of repPatterns) {
    const m = text.match(p)
    if (m) { result.representative = m[1].trim(); break }
  }

  const bizNumMatch = text.match(/(\d{3})-?(\d{2})-?(\d{5})/)
  if (bizNumMatch) {
    result.business_number = `${bizNumMatch[1]}-${bizNumMatch[2]}-${bizNumMatch[3]}`
  }

  const itemPatterns = [
    /(?:아이템명|사업명|과제명|프로젝트명|사업\s*아이템)\s*[:\-\s]*([^\n]{3,50})/,
  ]
  for (const p of itemPatterns) {
    const m = text.match(p)
    if (m) { result.item_name = m[1].trim(); break }
  }

  const addrPatterns = [
    /(?:소재지|주\s*소|사업장\s*소재지|사업장\s*주소)\s*[:\-\s]*([^\n]{5,80})/,
  ]
  for (const p of addrPatterns) {
    const m = text.match(p)
    if (m) { result.address = m[1].trim(); break }
  }

  if (text.includes('법인') && !text.includes('개인')) {
    result.business_type = '법인'
  } else if (text.includes('개인')) {
    result.business_type = '개인'
  }

  const totalPatterns = [
    /(?:총\s*사업비|총\s*사업\s*비용|사업\s*총액)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/,
  ]
  for (const p of totalPatterns) {
    const m = text.match(p)
    if (m) { result.total_budget = extractNumber(m[1]); break }
  }

  const govPatterns = [
    /(?:정부지원금|정부\s*지원\s*금|보조금|국비|지원금)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/,
  ]
  for (const p of govPatterns) {
    const m = text.match(p)
    if (m) { result.gov_support = extractNumber(m[1]); break }
  }

  const matchingPatterns = [
    /(?:대응자금|자부담|민간부담금|자기부담금|매칭펀드)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/,
  ]
  for (const p of matchingPatterns) {
    const m = text.match(p)
    if (m) { result.matching_fund = extractNumber(m[1]); break }
  }

  const datePatterns = [
    /(?:개업일|설립일|창업일|사업\s*개시일)\s*[:\-\s]*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
  ]
  for (const p of datePatterns) {
    const m = text.match(p)
    if (m) { result.open_date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; break }
  }

  const periodMatch = text.match(/(?:협약\s*기간|사업\s*기간|수행\s*기간)\s*[:\-\s]*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*[~\-–]\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (periodMatch) {
    result.agreement_start = `${periodMatch[1]}-${periodMatch[2].padStart(2, '0')}-${periodMatch[3].padStart(2, '0')}`
    result.agreement_end = `${periodMatch[4]}-${periodMatch[5].padStart(2, '0')}-${periodMatch[6].padStart(2, '0')}`
  }

  const empMatch = text.match(/(?:종업원\s*수|직원\s*수|고용\s*인원|현재\s*인원)\s*[:\-\s]*(\d+)\s*명?/)
  if (empMatch) { result.employees_current = parseInt(empMatch[1]) }

  const empPlanMatch = text.match(/(?:계획\s*인원|고용\s*계획|추가\s*채용|채용\s*계획)\s*[:\-\s]*(\d+)\s*명?/)
  if (empPlanMatch) { result.employees_planned = parseInt(empPlanMatch[1]) }

  const revMatch = text.match(/(?:전년도\s*매출|매출액|연매출|매출\s*실적)\s*[:\-\s]*([\d,]+\s*(?:만\s*)?원?)/)
  if (revMatch) { result.revenue_prev = extractNumber(revMatch[1]) }

  result.region = matchRegion(result.address || text)
  result.category = matchCategory(text)

  return result
}

// PDF 텍스트 추출 (pdf-parse v2 API)
async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdf-parse v2: PDFParse 클래스 사용
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require('pdf-parse')
  // data: Buffer 를 Uint8Array로 변환
  const uint8 = new Uint8Array(buffer)
  const parser = new PDFParse({ data: uint8 })
  try {
    const result = await parser.getText()
    return result.text || ''
  } finally {
    try { await parser.destroy() } catch { /* ignore */ }
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
    let extractedText = ''
    const fileName = file.name.toLowerCase()

    // PDF 파싱 (pdf-parse v2)
    if (fileName.endsWith('.pdf')) {
      try {
        extractedText = await extractPdfText(buffer)
      } catch (pdfErr: any) {
        console.error('PDF 파싱 오류:', pdfErr)
        return NextResponse.json({
          success: true,
          extractedData: {},
          rawTextPreview: '',
          warning: 'PDF 텍스트 추출에 실패했습니다. 스캔된 이미지 PDF는 지원하지 않습니다. 항목을 직접 입력해주세요.',
        })
      }
    }
    // DOCX 파싱
    else if (fileName.endsWith('.docx')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      extractedText = result.value || ''
    }
    // DOC, XLS, XLSX — 텍스트 추출 제한적
    else if (fileName.endsWith('.doc') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
      extractedText = buffer.toString('latin1')
        .replace(/[^\x20-\x7E\uAC00-\uD7A3]/g, ' ')
        .replace(/\s+/g, ' ')
    }
    else {
      return NextResponse.json({ error: '지원하지 않는 파일 형식입니다' }, { status: 400 })
    }

    if (!extractedText || extractedText.trim().length < 5) {
      return NextResponse.json({
        success: true,
        extractedData: {},
        rawTextPreview: '',
        warning: '파일에서 텍스트를 추출할 수 없습니다. PDF 또는 DOCX 형식을 권장합니다. 항목을 직접 입력해주세요.',
      })
    }

    const extractedData = extractCompanyInfo(extractedText)

    return NextResponse.json({
      success: true,
      extractedData,
      rawTextPreview: extractedText.substring(0, 500),
      rawTextLength: extractedText.length,
    })
  } catch (err: any) {
    console.error('Parse error:', err)
    // 항상 JSON으로 반환
    return NextResponse.json({
      success: true,
      extractedData: {},
      rawTextPreview: '',
      warning: `분석 중 오류: ${err.message || '알 수 없는 오류'}. 항목을 직접 입력해주세요.`,
    })
  }
}
