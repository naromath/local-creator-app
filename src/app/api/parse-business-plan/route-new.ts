import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import * as fs from 'fs'
import * as path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 60

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '')

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
    '인천': ['인천'], '광주': ['광주'], '대전': ['대전'], '울산': ['울산'], '세종': ['세종'], '경기': ['경기', '수원', '성남', '고양', '용인', '부천', '안산', '화성', '평택', '의정부', '시흥', '파주', '김포', '광명', '군포', '하남', '오산', '과천', '양주', '구리'],
    '강원': ['강원', '춘천', '원주', '강릉', '동해', '태백', '속초', '삼척'],
    '충북': ['충북', '청주', '충주', '제천', '보은', '옥천', '영동', '증평'],
    '충남': ['충남', '천안', '공주', '보령', '아산', '서산', '논산', '계룡', '당진'],
    '전북': ['전북', '전주', '군산', '익산', '정읍', '남원', '김제'],
    '전남': ['전남', '목포', '여수', '순천', '나주'],
    '경북': ['경북', '포항', '경주', '김천', '안동', '구미', '영주', '영천', '상주', '문경', '예천'],
    '경남': ['경남', '창원', '진주', '통영', '사천', '김해', '밀양', '거제', '양산'],
    '제주': ['제주'],
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

// PDF 파일을 Base64 바이너리로 변환
function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64')
}

// Gemini Vision을 이용한 OCR
async function extractTextWithGemini(buffer: Buffer, fileType: string): Promise<{ text: string; error?: string }> {
  try {
    console.log('Gemini OCR 시작:', { fileType, bufferLength: buffer.length })

    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      console.warn('Google Gemini API 키 없음 - PDF 파싱만 사용')
      return { text: '', error: 'API 키 미설정' }
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const base64Data = bufferToBase64(buffer)

    // 파일 타입에 따른 MIME 타입
    const mimeType = fileType === '.pdf' ? 'application/pdf' : 'image/png'

    const response = await model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      {
        text: '이 문서에서 텍스트를 모두 추출해주세요. 스캔된 문서나 이미지도 정확하게 인식해주세요. 한글, 숫자, 특수문자 모두 포함해서 추출해주세요.',
      },
    ])

    const extractedText = response.response.text()
    console.log('Gemini OCR 완료:', { textLength: extractedText.length })

    return { text: extractedText }
  } catch (err: any) {
    console.error('Gemini OCR 에러:', {
      message: err.message,
      error: err.error?.message || err,
    })
    return { text: '', error: `Gemini OCR 실패: ${err.message}` }
  }
}

// PDF 파싱 (텍스트 기반)
async function extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number; error?: string }> {
  try {
    console.log('PDF 파싱 시작:', { bufferLength: buffer.length })

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse')

    const header = buffer.slice(0, 5).toString('latin1')
    console.log('PDF 헤더:', header)

    const options = {
      max: 0,
      version: 'v1.10.100',
    }

    const data = await pdfParse(buffer, options)

    const text = (data.text || '').trim()
    const pageCount = data.numpages || data.numPages || 0

    console.log('PDF 파싱 성공:', { textLength: text.length, pageCount })

    return { text, pageCount }
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown error'
    console.error('PDF 파싱 에러:', { message: errorMsg })
    return { text: '', pageCount: 0, error: `PDF 파싱 실패: ${errorMsg.substring(0, 100)}` }
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    }

    console.log('파일 수신:', { name: file.name, size: file.size, type: file.type })

    const buffer = Buffer.from(await file.arrayBuffer())
    let extractedText = ''
    const fileName = file.name.toLowerCase()

    // PDF 처리
    if (fileName.endsWith('.pdf')) {
      console.log('=== PDF 처리 시작 ===')

      // 1단계: 일반 PDF 파싱 시도
      const pdfResult = await extractPdfText(buffer)
      extractedText = pdfResult.text

      if (extractedText.trim().length > 50) {
        console.log('PDF 파싱된 텍스트 충분 - Gemini OCR 스킵')
        const extractedData = extractCompanyInfo(extractedText)
        return NextResponse.json({
          success: true,
          extractedData,
          rawTextPreview: extractedText.substring(0, 500),
          rawTextLength: extractedText.length,
        })
      }

      // 2단계: 텍스트가 부족하면 Gemini OCR 시도
      console.log('PDF 텍스트 부족 - Gemini OCR 시작')
      const geminiResult = await extractTextWithGemini(buffer, '.pdf')

      if (geminiResult.error) {
        console.error('Gemini OCR 실패:', geminiResult.error)
        // OCR 실패했지만 기존 텍스트 사용
        if (extractedText.trim().length > 0) {
          const extractedData = extractCompanyInfo(extractedText)
          return NextResponse.json({
            success: true,
            extractedData,
            rawTextPreview: extractedText.substring(0, 500),
            rawTextLength: extractedText.length,
            warning: '기본 PDF 파싱 결과입니다. (OCR 실패)',
          })
        }
        return NextResponse.json({
          success: true,
          extractedData: {},
          rawTextPreview: '',
          warning: 'PDF 파싱 및 OCR 모두 실패. 항목을 직접 입력해주세요.',
        })
      }

      extractedText = geminiResult.text
      console.log('Gemini OCR 텍스트 사용:', { length: extractedText.length })
    }
    // DOCX 처리
    else if (fileName.endsWith('.docx')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mammoth = require('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        extractedText = result.value || ''
        console.log('DOCX 파싱 완료:', extractedText.length, 'chars')
      } catch (docErr: any) {
        console.error('DOCX 파싱 오류:', docErr.message)
        return NextResponse.json({
          success: true,
          extractedData: {},
          rawTextPreview: '',
          warning: 'Word 파일 처리 실패. 항목을 직접 입력해주세요.',
        })
      }
    }
    // 기타 파일 처리
    else if (fileName.endsWith('.doc') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
      try {
        extractedText = buffer.toString('latin1')
          .replace(/[^\x20-\x7E\uAC00-\uD7A3]/g, ' ')
          .replace(/\s+/g, ' ')
      } catch (legacyErr: any) {
        console.error('레거시 파일 처리 오류:', legacyErr.message)
        return NextResponse.json({
          success: true,
          extractedData: {},
          rawTextPreview: '',
          warning: '파일 처리 실패. 항목을 직접 입력해주세요.',
        })
      }
    }
    else {
      return NextResponse.json({ error: '지원하지 않는 파일 형식입니다' }, { status: 400 })
    }

    if (!extractedText || extractedText.trim().length < 5) {
      return NextResponse.json({
        success: true,
        extractedData: {},
        rawTextPreview: extractedText.substring(0, 200),
        warning: '파일에서 텍스트를 추출할 수 없습니다. 항목을 직접 입력해주세요.',
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
    console.error('Parse error 상세:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    })

    return NextResponse.json({
      success: true,
      extractedData: {},
      rawTextPreview: '',
      warning: `분석 중 오류 발생. 항목을 직접 입력해주세요. (${err.message || '알 수 없음'})`,
    })
  }
}
